"""Embeddings via Voyage `voyage-4` (1024-dim default, matching the `vector(1024)` column).

`voyage-4` costs the same as `voyage-3` ($0.06/M tokens) but includes 200M free tokens,
which covers roughly the first thousand technical reports. Changing model after a backfill
would require re-embedding the whole corpus, so the choice is fixed here deliberately.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Any

import voyageai
import voyageai.error

from .config import settings

logger = logging.getLogger(__name__)

MODEL = "voyage-4"
EMBEDDING_DIM = 1024

# Voyage caps each request at 1,000 texts and 320K tokens for this model.
_MAX_BATCH_TEXTS = 128

# The per-request token budget is set by the *account* tier, not the model: without a
# payment method on file Voyage allows 10K tokens/minute, so a 128-chunk batch (~100K
# tokens) can never succeed and no amount of retrying will help. Batching under that floor
# keeps the free tier working; paid accounts just send more, smaller requests, which their
# far higher request ceiling absorbs. Raise VOYAGE_MAX_TOKENS_PER_REQUEST to cut round trips.
_DEFAULT_MAX_TOKENS_PER_REQUEST = 9_000

# Matches CHARS_PER_TOKEN in the processor's chunk budget.
_CHARS_PER_TOKEN = 4

# A token-per-minute limit is a rolling window, so once backoff exceeds the window there is
# nothing to gain by doubling further -- it just idles. Cap the delay just past a minute and
# spend the extra attempts waiting instead, so a sustained limit throttles the run rather
# than failing documents that would have succeeded a minute later.
_MAX_ATTEMPTS = 10
_BACKOFF_BASE_SECONDS = 5.0
_BACKOFF_CAP_SECONDS = 65.0


@lru_cache
def _client() -> Any:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set; cannot embed.")
    return voyageai.Client(api_key=settings.voyage_api_key)


def _estimated_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _batches(texts: list[str], max_tokens: int) -> list[list[str]]:
    """Group texts into requests bounded by both count and estimated tokens.

    A single text over the token budget still ships alone: the API truncates to the model's
    context length, which is a better outcome than refusing to embed the chunk at all.
    """
    batches: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0
    for text in texts:
        tokens = _estimated_tokens(text)
        if current and (len(current) >= _MAX_BATCH_TEXTS or current_tokens + tokens > max_tokens):
            batches.append(current)
            current, current_tokens = [], 0
        current.append(text)
        current_tokens += tokens
    if current:
        batches.append(current)
    return batches


def _embed_batch(client: Any, batch: list[str], input_type: str) -> list[list[float]]:
    """Embed one batch, backing off through rate limits.

    Free-tier accounts are limited to a few requests per minute, so backoff starts at
    seconds rather than milliseconds; anything shorter just burns attempts.
    """
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return client.embed(batch, model=MODEL, input_type=input_type).embeddings
        except (voyageai.error.RateLimitError, voyageai.error.ServiceUnavailableError) as exc:
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            delay = min(_BACKOFF_BASE_SECONDS * (2**attempt), _BACKOFF_CAP_SECONDS)
            logger.warning("Voyage rate limited (%s); retrying in %.0fs", type(exc).__name__, delay)
            time.sleep(delay)
    raise AssertionError("unreachable")


def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Return one 1024-dim embedding per input text, preserving order."""
    if not texts:
        return []
    client = _client()
    max_tokens = settings.voyage_max_tokens_per_request or _DEFAULT_MAX_TOKENS_PER_REQUEST
    vectors: list[list[float]] = []
    for batch in _batches(texts, max_tokens):
        vectors.extend(_embed_batch(client, batch, input_type))
    return vectors
