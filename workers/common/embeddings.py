"""Embeddings via Voyage `voyage-3` (1024-dim, matching the `vector(1024)` column)."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import voyageai

from .config import settings

logger = logging.getLogger(__name__)

MODEL = "voyage-3"
EMBEDDING_DIM = 1024

# Voyage caps batch size; chunk large calls so a single embed_texts() call can accept
# an arbitrarily long list without a client-side error.
_MAX_BATCH = 128


@lru_cache
def _client() -> Any:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set; cannot embed.")
    return voyageai.Client(api_key=settings.voyage_api_key)


def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Return one 1024-dim embedding per input text, preserving order."""
    if not texts:
        return []
    client = _client()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _MAX_BATCH):
        batch = texts[start : start + _MAX_BATCH]
        result = client.embed(batch, model=MODEL, input_type=input_type)
        vectors.extend(result.embeddings)
    return vectors
