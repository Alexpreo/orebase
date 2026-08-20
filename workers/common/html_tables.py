"""Deterministic resource/economics extraction from original HTML tables.

HTML-origin EDGAR exhibits keep real <table> markup. A well-formed resource table
is parsed here at zero token cost; broken tables return nothing and Claude fills in.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

from .extract_schemas import ProjectEconomics, ResourceEstimate

logger = logging.getLogger(__name__)

_NUMBER = re.compile(r"[-+(]?\s*[\d]+(?:[.,]\d+)*\s*\)?")
_CATEGORY_MAP = {
    "measured": "measured",
    "indicated": "indicated",
    "inferred": "inferred",
    "proven": "proven",
    "proved": "proven",
    "probable": "probable",
}

_GRADE_HEADER = re.compile(
    r"(?<![a-z])(?P<metal>cu|au|ag|mo|ni|zn|pb|co|u3o8|u|li|fe|pd|pt|sio2|p2o5)(?![a-z])\s*"
    r"(?:\()?(?P<unit>%|pct|g/t|gpt|ppm|opt|oz/t)?",
    re.IGNORECASE,
)


def _cell_text(cell: Tag) -> str:
    return " ".join(cell.get_text(" ", strip=True).split())


def _parse_number(text: str) -> Optional[float]:
    cleaned = text.strip().replace("\u00a0", " ").replace(",", "")
    if not cleaned or cleaned in {"-", "—", "n/a", "na", "nil"}:
        return None
    match = _NUMBER.search(cleaned)
    if not match:
        return None
    token = match.group(0).replace(" ", "").replace("(", "-").replace(")", "")
    token = token.replace("+", "")
    try:
        return float(token)
    except ValueError:
        return None


def _header_cells(table: Tag) -> list[str]:
    rows = table.find_all("tr")
    if not rows:
        return []
    # Prefer the first row that has <th>, else the first row.
    for row in rows[:3]:
        headers = row.find_all("th")
        if headers:
            return [_cell_text(h).lower() for h in headers]
    first = rows[0].find_all(["th", "td"])
    return [_cell_text(h).lower() for h in first]


def _looks_like_resource(headers: list[str]) -> bool:
    joined = " ".join(headers)
    has_tonnes = any(key in joined for key in ("tonne", "tonnage", "kt", "mt"))
    has_grade = "grade" in joined or bool(_GRADE_HEADER.search(joined))
    has_category = any(
        key in joined for key in ("class", "category", "measured", "indicated", "inferred")
    )
    return has_tonnes and (has_grade or has_category)


def _looks_like_economics(headers: list[str]) -> bool:
    joined = " ".join(headers)
    return any(key in joined for key in ("npv", "irr", "capex", "aisc", "payback"))


def _tonnes_multiplier(header: str) -> float:
    if "mt" in header or "million" in header:
        return 1_000_000.0
    if "kt" in header or "thousand" in header:
        return 1_000.0
    return 1.0


def _grade_key(header: str) -> Optional[str]:
    match = _GRADE_HEADER.search(header)
    if not match:
        return None
    metal = match.group("metal").lower()
    special = {"sio2": "SiO2", "u3o8": "U3O8", "p2o5": "P2O5"}
    if metal in special:
        metal = special[metal]
    else:
        metal = metal[0].upper() + metal[1:].lower() if len(metal) > 2 else metal.upper()
        if len(metal) == 2:
            metal = metal[0] + metal[1].lower()
    unit_raw = (match.group("unit") or "").lower()
    if unit_raw in {"%", "pct"}:
        unit = "pct"
    elif unit_raw in {"g/t", "gpt"}:
        unit = "gpt"
    elif unit_raw == "ppm":
        unit = "ppm"
    elif unit_raw in {"opt", "oz/t"}:
        unit = "opt"
    elif metal.upper() in {"AU", "AG", "PD", "PT"}:
        unit = "gpt"
    else:
        unit = "pct"
    return f"{metal}_{unit}"


def _category_from_row(cells: list[str]) -> Optional[str]:
    blob = " ".join(cells).lower()
    for needle, mapped in _CATEGORY_MAP.items():
        if needle in blob:
            return mapped
    if "measured" in blob and "indicated" in blob:
        return "measured+indicated"
    return None


def _parse_resource_table(table: Tag) -> list[ResourceEstimate]:
    headers = _header_cells(table)
    if not _looks_like_resource(headers):
        return []
    tonnes_idx = next(
        (
            i
            for i, h in enumerate(headers)
            if "tonne" in h or "tonnage" in h or h.strip() in {"mt", "kt", "ktns"}
        ),
        None,
    )
    if tonnes_idx is None:
        return []
    tonnes_mult = _tonnes_multiplier(headers[tonnes_idx])
    grade_idxs = [
        (i, key)
        for i, h in enumerate(headers)
        if i != tonnes_idx and (key := _grade_key(h))
    ]
    rows: list[ResourceEstimate] = []
    body_rows = table.find_all("tr")[1:]
    for row in body_rows:
        cells = [_cell_text(c) for c in row.find_all(["td", "th"])]
        if len(cells) < 2:
            continue
        category = _category_from_row(cells)
        if not category:
            continue
        tonnes_raw = _parse_number(cells[tonnes_idx]) if tonnes_idx < len(cells) else None
        if tonnes_raw is None:
            continue
        grade: dict[str, float] = {}
        for idx, key in grade_idxs:
            if idx < len(cells):
                parsed = _parse_number(cells[idx])
                if parsed is not None:
                    grade[key] = parsed
        try:
            rows.append(
                ResourceEstimate(
                    category=category,
                    tonnes=tonnes_raw * tonnes_mult,
                    grade=grade,
                    extraction_confidence=0.9,
                )
            )
        except Exception as exc:  # noqa: BLE001 - skip a bad row, keep the rest
            logger.warning("skipped HTML resource row %s: %s", category, exc)
            continue
    return rows


def _kv_from_tables(soup: BeautifulSoup) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = [_cell_text(c) for c in row.find_all(["td", "th"])]
            if len(cells) >= 2:
                pairs[cells[0].lower()] = cells[1]
    return pairs


def _parse_economics(soup: BeautifulSoup) -> list[ProjectEconomics]:
    kv = _kv_from_tables(soup)
    npv: dict[str, float] = {}
    irr: Optional[float] = None
    capex: Optional[float] = None
    aisc: dict[str, float] = {}
    mine_life: Optional[float] = None
    payback: Optional[float] = None
    currency = None
    study_type = None
    for key, value in kv.items():
        number = _parse_number(value)
        if "post-tax" in key and "npv" in key and number is not None:
            npv["post_tax"] = number
        elif "pre-tax" in key and "npv" in key and number is not None:
            npv["pre_tax"] = number
        elif "npv" in key and number is not None and "post_tax" not in npv:
            npv["unspecified"] = number
        elif key.strip() in {"irr", "after-tax irr", "post-tax irr"} and number is not None:
            irr = number
        elif "capex" in key or "initial capital" in key:
            capex = number
        elif "aisc" in key and number is not None:
            aisc["aisc"] = number
        elif "mine life" in key or "loM" in key.lower():
            mine_life = number
        elif "payback" in key:
            payback = number
        elif "currency" in key and len(value.strip()) == 3:
            currency = value.strip().upper()
        elif "pea" in key:
            study_type = "pea"
        elif "pfs" in key or "pre-feasibility" in key:
            study_type = "pfs"
        elif re.search(r"\bfs\b|feasibility", key):
            study_type = "fs"
    if not npv and irr is None and capex is None:
        return []
    try:
        return [
            ProjectEconomics(
                study_type=study_type,
                currency=currency,
                npv=npv,
                irr_pct=irr,
                capex_initial=capex,
                aisc=aisc,
                mine_life_years=mine_life,
                payback_years=payback,
                extraction_confidence=0.9,
            )
        ]
    except Exception:  # noqa: BLE001
        return []


def extract_from_html(html: bytes | str) -> tuple[list[ResourceEstimate], list[ProjectEconomics]]:
    soup = BeautifulSoup(html, "html.parser")
    resources: list[ResourceEstimate] = []
    for table in soup.find_all("table"):
        resources.extend(_parse_resource_table(table))
    economics = _parse_economics(soup)
    logger.info(
        "html_tables parsed resources=%d economics=%d tables=%d",
        len(resources), len(economics), len(soup.find_all("table")),
    )
    return resources, economics
