"""Pydantic models and Claude tool JSON schemas for structured extraction."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .normalize import (
    normalize_commodities,
    normalize_country,
    normalize_stage,
    normalize_standard,
    normalize_study_type,
)

GRADE_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,5}_(pct|gpt|ppm|opt)$")
METAL_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,5}_(lb|oz|t|kg|kt)$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

_UNIT_RANGE = {
    "pct": (0.0, 100.0),
    "gpt": (0.0, 50_000.0),
    "ppm": (0.0, 1_000_000.0),
    "opt": (0.0, 10_000.0),
}

RESOURCE_CATEGORIES = frozenset(
    {"measured", "indicated", "inferred", "proven", "probable", "measured+indicated", "2p"}
)
TECHNICAL_DOC_TYPES = frozenset({"sk1300", "ni43101", "jorc", "pea", "pfs", "fs"})

MAX_TONNES = 1e12
# Below this a resource row is far more likely a missed Mt/kt conversion than a real deposit.
MIN_PLAUSIBLE_TONNES = 10_000
SHORT_TON = 0.90718474
# short_* = US short tons ("tons" in US reports); converted to metric here.
TONNAGE_UNITS = {
    "t": 1.0, "kt": 1e3, "mt": 1e6,
    "short_t": SHORT_TON, "short_kt": SHORT_TON * 1e3, "short_mt": SHORT_TON * 1e6,
}
# Bare pre_tax/post_tax come from HTML tables that print no discount rate.
NPV_KEY_RE = re.compile(r"^(pre|post)_tax(_\d+(\.\d+)?pct)?$")
# Economics money is in millions of `currency`. A capex or NPV this large was given in dollars.
MONEY_IN_DOLLARS_MIN = 1_000_000.0
MONEY_AMBIGUOUS_MIN = 100_000.0
# Au/Ag/PGE grades above this in g/t are almost always contained ounces put in the grade column.
GPT_AS_OUNCES_MIN = 5_000.0

_BASE_WORDS = r"(measured|indicated|inferred|proven|proved|probable)"
_COMBINED = (
    (re.compile(r"\bm\s*(?:\+|&|and)\s*i\b"), "measured+indicated"),
    (re.compile(r"\b(?:p\s*(?:\+|&|and)\s*p|2p)\b"), "2p"),
)
_NOISE = re.compile(
    _BASE_WORDS + r"|\bmineral\b|\btotal\b|\bm\s*(?:\+|&)\s*i\b|\bp\s*(?:\+|&)\s*p\b|\b2p\b"
    r"|(?<!of )(?<!inclusive )(?<!exclusive )\b(?:resources?|reserves?)\b"
)


def split_category(label: str) -> tuple[str, Optional[str]]:
    """'Indicated - Upper Zone (exclusive of reserves)' -> ('indicated', 'upper zone (exclusive of reserves)').

    The base is one of RESOURCE_CATEGORIES when the label names exactly one class or a
    standard pair (M+I, P+P); otherwise the cleaned label is returned unchanged as base.
    """
    text = " ".join(label.strip().lower().split())
    found = {"proven" if w == "proved" else w for w in re.findall(_BASE_WORDS, text)}
    for pattern, combined in _COMBINED:
        if pattern.search(text):
            found |= {"measured", "indicated"} if combined == "measured+indicated" else {"proven", "probable"}
    if found == {"measured", "indicated"}:
        base = "measured+indicated"
    elif found == {"proven", "probable"}:
        base = "2p"
    elif len(found) == 1:
        base = found.pop()
    else:
        return text, None
    rest = _NOISE.sub(" ", text)
    rest = re.sub(r"\(\s*\)", " ", rest)
    rest = re.sub(r"^(?:[\s\-+&,;:/]|and\b)+|(?:[\s\-+&,;:/]|\band)+$", "", rest)
    rest = " ".join(rest.split())
    if rest.startswith("(") and rest.endswith(")") and rest.count("(") == 1:
        rest = rest[1:-1].strip()
    return base, rest or None
MAX_IRR_PCT = 500.0


def _parse_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


class TriageResult(BaseModel):
    company_name: str
    cik: Optional[str] = None
    ticker: Optional[str] = None
    project_name: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    commodities: list[str] = Field(default_factory=list)
    stage: Optional[str] = None
    doc_type: Optional[str] = None
    summary: str

    @field_validator("company_name", "summary")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("required text field is empty")
        return text

    @field_validator("project_name")
    @classmethod
    def _optional_project(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = value.strip()
        return text or None

    @field_validator("cik")
    @classmethod
    def _normalize_cik(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        digits = re.sub(r"\D", "", value)
        if not digits:
            return None
        return digits.zfill(10)[-10:]

    @field_validator("commodities")
    @classmethod
    def _clean_commodities(cls, value: list[str]) -> list[str]:
        return normalize_commodities(value)

    @field_validator("stage")
    @classmethod
    def _stage(cls, value: Optional[str]) -> Optional[str]:
        return normalize_stage(value)

    @field_validator("country")
    @classmethod
    def _country(cls, value: Optional[str]) -> Optional[str]:
        return normalize_country(value)


class ResourceEstimate(BaseModel):
    category: str
    domain: Optional[str] = None
    tonnes: float
    tonnage_unit: Optional[str] = None  # unit `tonnes` was printed in; None = already tonnes
    grade: dict[str, float] = Field(default_factory=dict)
    contained_metal: dict[str, float] = Field(default_factory=dict)
    cutoff: Optional[str] = None
    standard: Optional[str] = None
    effective_date: Optional[date] = None
    extraction_confidence: float = 0.7
    source_page: Optional[int] = None

    @field_validator("standard")
    @classmethod
    def _standard(cls, value: Optional[str]) -> Optional[str]:
        return normalize_standard(value)


    @field_validator("effective_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> Optional[date]:
        return _parse_date(value)

    @field_validator("extraction_confidence")
    @classmethod
    def _confidence(cls, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    @model_validator(mode="after")
    def _sanity(self) -> ResourceEstimate:
        confidence = self.extraction_confidence
        base, qualifier = split_category(self.category)
        object.__setattr__(self, "category", base)
        object.__setattr__(self, "domain", self.domain or qualifier)
        if self.tonnage_unit is not None:
            factor = TONNAGE_UNITS.get(self.tonnage_unit.strip().lower())
            if factor is None:
                confidence = min(confidence, 0.3)
            else:
                object.__setattr__(self, "tonnes", self.tonnes * factor)
            object.__setattr__(self, "tonnage_unit", None)
        if self.tonnes <= 0 or self.tonnes > MAX_TONNES:
            confidence = min(confidence, 0.3)
        elif self.tonnes < MIN_PLAUSIBLE_TONNES:
            confidence = min(confidence, 0.5)
        if self.category not in RESOURCE_CATEGORIES:
            confidence = min(confidence, 0.3)
        cleaned_grade: dict[str, float] = {}
        moved_metal: dict[str, float] = {}
        for key, raw in self.grade.items():
            if not GRADE_KEY_RE.match(key):
                confidence = min(confidence, 0.4)
                continue
            unit = key.rsplit("_", 1)[-1]
            lo, hi = _UNIT_RANGE[unit]
            try:
                number = float(raw)
            except (TypeError, ValueError):
                confidence = min(confidence, 0.3)
                continue
            if unit == "gpt" and number >= GPT_AS_OUNCES_MIN:
                # Contained ounces in the grade column (e.g. Au_gpt 1,250,000): move them.
                moved_metal[f"{key.rsplit('_', 1)[0]}_oz"] = number
                confidence = min(confidence, 0.5)
                continue
            if number < lo or number > hi:
                confidence = min(confidence, 0.3)
            cleaned_grade[key] = number
        cleaned_metal: dict[str, float] = {}
        for key, raw in self.contained_metal.items():
            if not METAL_KEY_RE.match(key):
                continue
            try:
                number = float(raw)
            except (TypeError, ValueError):
                continue
            if number >= 0:
                cleaned_metal[key] = number
        for key, number in moved_metal.items():
            cleaned_metal.setdefault(key, number)
        object.__setattr__(self, "grade", cleaned_grade)
        object.__setattr__(self, "contained_metal", cleaned_metal)
        object.__setattr__(self, "extraction_confidence", confidence)
        return self


class ProjectEconomics(BaseModel):
    study_type: Optional[str] = None
    effective_date: Optional[date] = None
    currency: Optional[str] = None
    npv: dict[str, float] = Field(default_factory=dict)
    irr_pct: Optional[float] = None
    capex_initial: Optional[float] = None
    aisc: dict[str, float] = Field(default_factory=dict)
    mine_life_years: Optional[float] = None
    payback_years: Optional[float] = None
    metal_price_assumptions: dict[str, float] = Field(default_factory=dict)
    extraction_confidence: float = 0.7
    source_page: Optional[int] = None

    @field_validator("study_type")
    @classmethod
    def _study(cls, value: Optional[str]) -> Optional[str]:
        return normalize_study_type(value)

    @field_validator("currency")
    @classmethod
    def _currency(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        code = value.strip().upper()
        if not CURRENCY_RE.match(code):
            return None
        return code

    @field_validator("effective_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> Optional[date]:
        return _parse_date(value)

    @field_validator("extraction_confidence")
    @classmethod
    def _confidence(cls, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    @model_validator(mode="after")
    def _sanity(self) -> ProjectEconomics:
        confidence = self.extraction_confidence
        if self.irr_pct is not None and (self.irr_pct < 0 or self.irr_pct > MAX_IRR_PCT):
            confidence = min(confidence, 0.3)
        if self.capex_initial is not None and self.capex_initial < 0:
            confidence = min(confidence, 0.3)
        capex, confidence = _millions(self.capex_initial, confidence)
        object.__setattr__(self, "capex_initial", capex)
        npv: dict[str, float] = {}
        for key, raw in self.npv.items():
            if not NPV_KEY_RE.match(key):
                # "unspecified", "npv", ... are usually revenue or cash-flow totals.
                confidence = min(confidence, 0.4)
                continue
            value, confidence = _millions(float(raw), confidence)
            if value is not None:
                npv[key] = value
        object.__setattr__(self, "npv", npv)
        if self.mine_life_years is not None and self.mine_life_years < 0:
            confidence = min(confidence, 0.3)
        object.__setattr__(self, "extraction_confidence", confidence)
        return self


def _millions(value: Optional[float], confidence: float) -> tuple[Optional[float], float]:
    """Money is stored in millions. Values in dollars are rescaled; thousands are only flagged."""
    if value is None:
        return None, confidence
    size = abs(value)
    if size >= MONEY_IN_DOLLARS_MIN:
        return value / 1e6, min(confidence, 0.6)
    if size >= MONEY_AMBIGUOUS_MIN:
        return value, min(confidence, 0.3)
    return value, confidence


class DrillResult(BaseModel):
    hole_id: Optional[str] = None
    announced_date: Optional[date] = None
    from_m: Optional[float] = None
    to_m: Optional[float] = None
    interval_m: Optional[float] = None
    assays: dict[str, float] = Field(default_factory=dict)
    true_width_noted: Optional[bool] = None
    extraction_confidence: float = 0.7
    source_page: Optional[int] = None

    @field_validator("announced_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> Optional[date]:
        return _parse_date(value)

    @field_validator("extraction_confidence")
    @classmethod
    def _confidence(cls, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    @model_validator(mode="after")
    def _interval(self) -> DrillResult:
        confidence = self.extraction_confidence
        if (
            self.from_m is not None
            and self.to_m is not None
            and self.to_m < self.from_m
        ):
            confidence = min(confidence, 0.3)
        if self.interval_m is None and self.from_m is not None and self.to_m is not None:
            object.__setattr__(self, "interval_m", abs(self.to_m - self.from_m))
        object.__setattr__(self, "extraction_confidence", confidence)
        return self


class QualifiedPerson(BaseModel):
    name: str
    designation: Optional[str] = None
    firm: Optional[str] = None
    role: str = ""

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("QP name is required")
        return text


TRIAGE_SYSTEM = (
    "You extract mining-filing metadata. Use only the provided text. "
    "Call the triage tool. If a field is unknown, omit it rather than guess. "
    "Never set project_name to the company name; omit project_name if the "
    "deposit or project is not named in the text."
)

EXTRACT_SYSTEM = (
    "You extract numeric facts from mining technical reports. Use only the provided "
    "text. Call the given tool. Omit rows you cannot support from the text. "
    "Grade keys MUST be like Cu_pct, Au_gpt, Ag_gpt, Mo_pct, U3O8_pct. "
    "Contained-metal keys MUST be like Cu_lb, Au_oz, Ag_oz. "
    "NPV keys MUST be like post_tax_5pct or pre_tax_8pct; omit an NPV whose tax basis or "
    "discount rate is not stated. NPV and capex_initial are in MILLIONS of the currency. "
    "capex_initial is initial (pre-production) capital only, never life-of-mine or "
    "sustaining capital. Contained ounces or pounds go in contained_metal, never in grade. "
    "Do not invent numbers."
)

TRIAGE_TOOL: dict[str, Any] = {
    "name": "record_triage",
    "description": "Company, project, and one-line summary for this filing.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["company_name", "summary"],
        "properties": {
            "company_name": {"type": "string"},
            "cik": {"type": "string"},
            "ticker": {"type": "string"},
            "project_name": {"type": "string"},
            "country": {"type": "string"},
            "region": {"type": "string"},
            "commodities": {"type": "array", "items": {"type": "string"}},
            "stage": {"type": "string"},
            "doc_type": {"type": "string"},
            "summary": {"type": "string"},
        },
    },
}

RESOURCE_TOOL: dict[str, Any] = {
    "name": "record_resource_estimates",
    "description": "Mineral resource and reserve rows from this report.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["category", "tonnes", "tonnage_unit", "grade"],
                    "properties": {
                        "category": {
                            "type": "string",
                            "description": "Classification only: measured, indicated, inferred, "
                            "measured+indicated, proven, probable or 2p.",
                        },
                        "domain": {
                            "type": "string",
                            "description": "Short qualifier (a few words) naming the zone, deposit, "
                            "pit/underground or inclusive/exclusive of reserves, if any. No notes.",
                        },
                        "tonnes": {
                            "type": "number",
                            "description": "Tonnage exactly as printed in the table; do not convert.",
                        },
                        "tonnage_unit": {
                            "type": "string",
                            "enum": ["t", "kt", "Mt", "short_t", "short_kt", "short_Mt"],
                            "description": "Unit of the printed tonnage (check the column header "
                            "and table notes, e.g. '000 t' = kt, 'Mt' or 'millions of tonnes' = Mt). "
                            "Use short_* when the report prints 'tons' (US short tons), e.g. "
                            "'million tons' = short_Mt, unless it says metric tons or tonnes.",
                        },
                        "grade": {"type": "object", "additionalProperties": {"type": "number"}},
                        "contained_metal": {
                            "type": "object",
                            "additionalProperties": {"type": "number"},
                        },
                        "cutoff": {"type": "string"},
                        "standard": {"type": "string"},
                        "effective_date": {"type": "string"},
                        "extraction_confidence": {"type": "number"},
                        "source_page": {"type": "integer"},
                    },
                },
            }
        },
    },
}

ECONOMICS_TOOL: dict[str, Any] = {
    "name": "record_project_economics",
    "description": "PEA/PFS/FS economics from this report.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "study_type": {"type": "string"},
                        "effective_date": {"type": "string"},
                        "currency": {"type": "string"},
                        "npv": {"type": "object", "additionalProperties": {"type": "number"}},
                        "irr_pct": {"type": "number"},
                        "capex_initial": {"type": "number"},
                        "aisc": {"type": "object", "additionalProperties": {"type": "number"}},
                        "mine_life_years": {"type": "number"},
                        "payback_years": {"type": "number"},
                        "metal_price_assumptions": {
                            "type": "object",
                            "additionalProperties": {"type": "number"},
                        },
                        "extraction_confidence": {"type": "number"},
                        "source_page": {"type": "integer"},
                    },
                },
            }
        },
    },
}

DRILL_TOOL: dict[str, Any] = {
    "name": "record_drill_results",
    "description": "Highlighted drill intercepts from this report.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "hole_id": {"type": "string"},
                        "announced_date": {"type": "string"},
                        "from_m": {"type": "number"},
                        "to_m": {"type": "number"},
                        "interval_m": {"type": "number"},
                        "assays": {"type": "object", "additionalProperties": {"type": "number"}},
                        "true_width_noted": {"type": "boolean"},
                        "extraction_confidence": {"type": "number"},
                        "source_page": {"type": "integer"},
                    },
                },
            }
        },
    },
}

QP_TOOL: dict[str, Any] = {
    "name": "record_qualified_persons",
    "description": "Qualified persons named in this report.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name"],
                    "properties": {
                        "name": {"type": "string"},
                        "designation": {"type": "string"},
                        "firm": {"type": "string"},
                        "role": {"type": "string"},
                    },
                },
            }
        },
    },
}
