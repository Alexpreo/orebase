"""Anthropic Messages client for structured extraction.

Prompt-caches the system prompt and tool schemas. Token usage is converted to USD
and written to app.extraction_costs so the daily/monthly caps have a ledger to sum.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional

import anthropic

from .config import settings
from .db import insert_extraction_cost

logger = logging.getLogger(__name__)

# USD per million tokens. Cache reads are 10% of input; cache writes are 1.25x.
# Rates follow current published Haiku 4.5 / Sonnet 4.5 list prices.
_RATES: dict[str, tuple[Decimal, Decimal]] = {
    "haiku": (Decimal("1.00"), Decimal("5.00")),
    "sonnet": (Decimal("3.00"), Decimal("15.00")),
}
_CACHE_READ_MULT = Decimal("0.10")
_CACHE_WRITE_MULT = Decimal("1.25")
_MILLION = Decimal("1000000")

DEFAULT_MAX_TOKENS = 8192


def _tier(model: str) -> str:
    name = model.lower()
    if "haiku" in name:
        return "haiku"
    return "sonnet"


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int = 0) -> Decimal:
    input_rate, output_rate = _RATES[_tier(model)]
    return (
        Decimal(input_tokens) * input_rate + Decimal(output_tokens) * output_rate
    ) / _MILLION


def cost_from_usage(model: str, usage: Any) -> tuple[int, int, int, int, Decimal]:
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    input_rate, output_rate = _RATES[_tier(model)]
    cost = (
        Decimal(input_tokens) * input_rate
        + Decimal(cache_write) * input_rate * _CACHE_WRITE_MULT
        + Decimal(cache_read) * input_rate * _CACHE_READ_MULT
        + Decimal(output_tokens) * output_rate
    ) / _MILLION
    return input_tokens, output_tokens, cache_read, cache_write, cost.quantize(Decimal("0.000001"))


class ClaudeUnavailable(RuntimeError):
    """Raised when the Anthropic API cannot complete a request (billing, auth, outage)."""


def _client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set; cannot call Claude.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def complete_tool(
    *,
    model: str,
    system: str,
    user: str,
    tools: list[dict[str, Any]],
    tool_choice: str,
    purpose: str,
    document_id: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Call Claude forced onto one tool. Returns the tool input dict (possibly empty).

    In dry_run mode no API call is made; an estimated input-token cost is logged
    instead so a queued batch can be priced before spend starts.
    """
    if dry_run:
        est_in = max(1, (len(system) + len(user)) // 4)
        cost = estimate_cost_usd(model, est_in)
        if settings.debug:
            logger.info(
                "[DEBUG] claude.dry_run purpose=%s model=%s est_input_tokens=%d cost_usd=%s",
                purpose, model, est_in, cost,
            )
        return {"_dry_run": True, "_est_input_tokens": est_in, "_est_cost_usd": str(cost)}

    cached_tools = [dict(tool) for tool in tools]
    if cached_tools:
        cached_tools[-1] = {**cached_tools[-1], "cache_control": {"type": "ephemeral"}}

    try:
        response = _client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=cached_tools,
            tool_choice={"type": "tool", "name": tool_choice},
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIStatusError as exc:
        raise ClaudeUnavailable(str(exc)) from exc

    input_tokens, output_tokens, cache_read, cache_write, cost = cost_from_usage(
        model, response.usage
    )
    insert_extraction_cost(
        document_id=document_id,
        model=model,
        purpose=purpose,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read,
        cache_creation_tokens=cache_write,
        cost_usd=cost,
    )
    if settings.debug:
        logger.info(
            "[DEBUG] claude.complete purpose=%s model=%s input=%d output=%d "
            "cache_read=%d cache_write=%d cost_usd=%s",
            purpose, model, input_tokens, output_tokens, cache_read, cache_write, cost,
        )

    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == tool_choice:
            payload = block.input
            return payload if isinstance(payload, dict) else {}
    return {}
