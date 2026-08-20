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
    tonnes: float
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

    @field_validator("category")
    @classmethod
    def _category(cls, value: str) -> str:
        key = value.strip().lower().replace(" ", "")
        mapping = {
            "measuredtotal": "measured",
            "indicatedtotal": "indicated",
            "mi": "measured+indicated",
            "m+i": "measured+indicated",
            "measuredandindicated": "measured+indicated",
            "provenandprobable": "2p",
            "p+p": "2p",
        }
        mapped = mapping.get(key, value.strip().lower())
        if mapped not in RESOURCE_CATEGORIES:
            return mapped  # keep unknown labels; confidence will be lowered
        return mapped

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
        if self.tonnes <= 0 or self.tonnes > MAX_TONNES:
            confidence = min(confidence, 0.3)
        if self.category not in RESOURCE_CATEGORIES:
            confidence = min(confidence, 0.3)
        cleaned_grade: dict[str, float] = {}
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
        if self.mine_life_years is not None and self.mine_life_years < 0:
            confidence = min(confidence, 0.3)
        object.__setattr__(self, "extraction_confidence", confidence)
        return self


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
    "NPV keys MUST be like post_tax_5pct or pre_tax_8pct. "
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
                    "required": ["category", "tonnes", "grade"],
                    "properties": {
                        "category": {"type": "string"},
                        "tonnes": {"type": "number"},
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
