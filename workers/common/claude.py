"""Anthropic Messages client for structured extraction.

Prompt-caches the system prompt and tool schemas. Token usage is converted to USD
and written to app.extraction_costs so the daily/monthly caps have a ledger to sum.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Any, Optional

import anthropic

from .config import settings
from .db import insert_extraction_cost

logger = logging.getLogger(__name__)

# USD per million tokens: (input, output, cache read). Cache writes are 1.25x input.
# Longest matching prefix wins; older ids stay so historical ledger rows re-price correctly.
_RATES: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "claude-opus-5-5": (Decimal("4.00"), Decimal("20.00"), Decimal("0.20")),
    "claude-sonnet-5-5": (Decimal("2.00"), Decimal("10.00"), Decimal("0.10")),
    "claude-sonnet-5": (Decimal("2.00"), Decimal("10.00"), Decimal("0.20")),
    "claude-opus-5": (Decimal("5.00"), Decimal("25.00"), Decimal("0.50")),
    "claude-opus-4": (Decimal("5.00"), Decimal("25.00"), Decimal("0.50")),
    "claude-sonnet-4": (Decimal("3.00"), Decimal("15.00"), Decimal("0.30")),
    "claude-haiku-5-5": (Decimal("0.10"), Decimal("0.50"), Decimal("0.01")),
    "claude-haiku-4-5": (Decimal("1.00"), Decimal("5.00"), Decimal("0.10")),
}
# Haiku 5.5 bills prompts over 100K input tokens at a higher tier.
_LONG_PROMPT_TOKENS = 100_000
_LONG_PROMPT_RATES: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "claude-haiku-5-5": (Decimal("0.50"), Decimal("2.50"), Decimal("0.05")),
}
# Models with server-side refusal fallbacks (Haiku has none).
_FALLBACK_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")
# Unknown ids are priced at the most expensive listed rate so the cap errs safe.
_FALLBACK_RATE = (Decimal("5.00"), Decimal("25.00"), Decimal("0.50"))
_CACHE_WRITE_MULT = Decimal("1.25")
_BATCH_MULT = Decimal("0.50")
_MILLION = Decimal("1000000")
BATCH_POLL_SECONDS = 20
BATCH_TIMEOUT_SECONDS = 3600

# Thinking is always on for Sonnet 5.5 / Opus 5.5 and counts against max_tokens.
DEFAULT_MAX_TOKENS = 32000
EFFORT = "high"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _rates(model: str, prompt_tokens: int = 0) -> tuple[Decimal, Decimal, Decimal]:
    name = model.lower()
    if prompt_tokens > _LONG_PROMPT_TOKENS:
        for prefix, rates in _LONG_PROMPT_RATES.items():
            if name.startswith(prefix):
                return rates
    for prefix in sorted(_RATES, key=len, reverse=True):
        if name.startswith(prefix):
            return _RATES[prefix]
    return _FALLBACK_RATE


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int = 0) -> Decimal:
    input_rate, output_rate, _ = _rates(model)
    return (
        Decimal(input_tokens) * input_rate + Decimal(output_tokens) * output_rate
    ) / _MILLION


def cost_from_usage(model: str, usage: Any, *, batch: bool = False) -> tuple[int, int, int, int, Decimal]:
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    input_rate, output_rate, read_rate = _rates(
        model, input_tokens + cache_read + cache_write
    )
    if batch:
        input_rate *= _BATCH_MULT
        output_rate *= _BATCH_MULT
        read_rate *= _BATCH_MULT
    cost = (
        Decimal(input_tokens) * input_rate
        + Decimal(cache_write) * input_rate * _CACHE_WRITE_MULT
        + Decimal(cache_read) * read_rate
        + Decimal(output_tokens) * output_rate
    ) / _MILLION
    return input_tokens, output_tokens, cache_read, cache_write, cost.quantize(Decimal("0.000001"))


class ClaudeUnavailable(RuntimeError):
    """Raised when the Anthropic API cannot complete a request (billing, auth, outage)."""


class ClaudeNoResult(RuntimeError):
    """The model answered but gave no usable tool call (refusal, truncation, skipped tool).

    Treated as a job failure so it retries; never as "the document has no facts".
    """


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
    use_batch: bool = False,
) -> dict[str, Any]:
    """Call Claude with one tool and return that tool's input dict.

    Current models reject forced tool_choice, so the call uses `auto` plus an explicit
    instruction, and a reply without the tool call raises ClaudeNoResult.

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

    system_block = [
        {
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }
    ]
    instruction = (
        f"\n\nRecord your answer by calling the {tool_choice} tool exactly once. "
        "If the text supports no rows, call it with an empty rows list."
    )
    params: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system_block,
        "tools": cached_tools,
        "tool_choice": {"type": "auto"},
        "output_config": {"effort": EFFORT},
        "messages": [{"role": "user", "content": user + instruction}],
    }

    try:
        if use_batch:
            response = _complete_via_batch(params)
        else:
            # Streaming keeps a long thinking + large-tool-input reply under HTTP timeouts.
            # Server-side fallbacks re-run a safety-classifier refusal on another model.
            extra: dict[str, Any] = {}
            if model.startswith(_FALLBACK_MODELS):
                extra = {"betas": [FALLBACK_BETA], "fallbacks": "default"}
            with _client().beta.messages.stream(**params, **extra) as stream:
                response = stream.get_final_message()
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise ClaudeUnavailable(str(exc)) from exc

    billed_model = getattr(response, "model", None) or model
    input_tokens, output_tokens, cache_read, cache_write, cost = cost_from_usage(
        billed_model, response.usage, batch=use_batch
    )
    insert_extraction_cost(
        document_id=document_id,
        model=billed_model,
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

    stop_reason = getattr(response, "stop_reason", None)
    if stop_reason in {"refusal", "max_tokens"}:
        raise ClaudeNoResult(f"{purpose}: stop_reason={stop_reason} on {billed_model}")
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == tool_choice:
            payload = block.input
            if isinstance(payload, dict):
                return payload
    raise ClaudeNoResult(f"{purpose}: {billed_model} did not call {tool_choice}")


def _complete_via_batch(params: dict[str, Any]) -> Any:
    """Submit a one-request Message Batch and wait for the result (50% list price)."""
    client = _client()
    batch = client.messages.batches.create(
        requests=[{"custom_id": "extract", "params": params}]
    )
    deadline = time.monotonic() + BATCH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        current = client.messages.batches.retrieve(batch.id)
        status = getattr(current, "processing_status", None)
        if status in {"ended", "canceled", "expired"}:
            break
        time.sleep(BATCH_POLL_SECONDS)
    else:
        raise ClaudeUnavailable(f"batch {batch.id} timed out")
    for item in client.messages.batches.results(batch.id):
        result = getattr(item, "result", None)
        if result is None:
            continue
        result_type = getattr(result, "type", None)
        if result_type == "succeeded":
            return result.message
        raise ClaudeUnavailable(f"batch item failed: {result_type}")
    raise ClaudeUnavailable(f"batch {batch.id} returned no results")
