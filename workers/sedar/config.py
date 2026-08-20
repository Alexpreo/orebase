"""SEDAR+ slice and document-type configuration.

Historical slices are defined here so `backfill.py` has a single source of
truth, but incremental ingest does not iterate them.
"""

from __future__ import annotations

from dataclasses import dataclass

# Public search landing page. Override with SEDAR_SEARCH_URL if CSA rotates the id.
DEFAULT_SEARCH_URL = (
    "https://www.sedarplus.ca/csa-party/viewInstance/view.html"
    "?id=0c11f8b7998bcd96fb9cb36b800b9dfdd7cbf07b7cf2bde3"
)

CHALLENGE_MARKERS = (
    "radware",
    "access denied",
    "pardon our interruption",
    "bot detection",
    "captcha",
    "please verify you are a human",
    "request unsuccessful",
)

MINING_KEYWORDS = (
    "mining",
    "mineral",
    "gold",
    "copper",
    "lithium",
    "uranium",
    "nickel",
    "zinc",
    "silver",
    "ore",
    "exploration",
    "resource",
    "potash",
    "graphite",
    "cobalt",
)

DOC_TYPE_MAP: tuple[tuple[str, str], ...] = (
    ("ni 43-101", "ni43101"),
    ("43-101", "ni43101"),
    ("technical report", "ni43101"),
    ("preliminary economic", "pea"),
    ("pea", "pea"),
    ("pre-feasibility", "pfs"),
    ("prefeasibility", "pfs"),
    ("feasibility", "fs"),
    ("news release", "press_release"),
    ("press release", "press_release"),
    ("material change", "mda"),
    ("md&a", "mda"),
    ("management's discussion", "mda"),
    ("annual information", "financials"),
    ("aif", "financials"),
)


@dataclass(frozen=True)
class BackfillSlice:
    name: str
    document_type_query: str
    date_from: str
    date_to: str
    doc_type: str


# Newest-first. Do not run until incremental ingest and review are trusted.
BACKFILL_SLICES: tuple[BackfillSlice, ...] = (
    BackfillSlice("ni43101_2024_present", "NI 43-101", "2024-01-01", "2026-12-31", "ni43101"),
    BackfillSlice("ni43101_2021_2023", "NI 43-101", "2021-01-01", "2023-12-31", "ni43101"),
)


def map_doc_type(label: str) -> str:
    lowered = (label or "").lower()
    for needle, mapped in DOC_TYPE_MAP:
        if needle in lowered:
            return mapped
    return "ni43101"
