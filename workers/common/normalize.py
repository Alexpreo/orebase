"""Canonical vocab for extracted mining entities.

Triage and Claude output use free text; screener filters and company/project
pages need a single spelling per commodity, stage, country, study type, and
reporting standard.
"""

from __future__ import annotations

import re
from typing import Optional

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_PROJECT_NOISE = re.compile(
    r"\b(the|project|mine|deposit|property|operation|operations|inc|incorporated|corp|corporation|ltd|limited|plc)\b",
    re.IGNORECASE,
)

STAGE_VALUES = (
    "grassroots",
    "exploration",
    "resource",
    "pea",
    "pfs",
    "fs",
    "permitting",
    "construction",
    "production",
    "care_maintenance",
)

STUDY_TYPES = frozenset({"pea", "pfs", "fs", "scoping", "other"})
RESOURCE_STANDARDS = frozenset({"SK-1300", "NI43-101", "JORC"})

_COMMODITY_ALIASES: dict[str, str] = {
    "cu": "Cu",
    "copper": "Cu",
    "au": "Au",
    "gold": "Au",
    "ag": "Ag",
    "silver": "Ag",
    "mo": "Mo",
    "molybdenum": "Mo",
    "moly": "Mo",
    "ni": "Ni",
    "nickel": "Ni",
    "zn": "Zn",
    "zinc": "Zn",
    "pb": "Pb",
    "lead": "Pb",
    "u": "U3O8",
    "u3o8": "U3O8",
    "uranium": "U3O8",
    "v": "V",
    "vanadium": "V",
    "li": "Li",
    "lithium": "Li",
    "co": "Co",
    "cobalt": "Co",
    "mn": "Mn",
    "manganese": "Mn",
    "sio2": "SiO2",
    "silica": "SiO2",
    "silicasand": "SiO2",
    "pt": "Pt",
    "platinum": "Pt",
    "pd": "Pd",
    "palladium": "Pd",
    "fe": "Fe",
    "iron": "Fe",
    "ironore": "Fe",
    "sn": "Sn",
    "tin": "Sn",
    "w": "W",
    "tungsten": "W",
    "ree": "REE",
    "rareearth": "REE",
    "rareearths": "REE",
}

_STAGE_ALIASES: dict[str, str] = {
    "grassroots": "grassroots",
    "grassroot": "grassroots",
    "generative": "grassroots",
    "earlystage": "grassroots",
    "exploration": "exploration",
    "exploratory": "exploration",
    "resource": "resource",
    "resourcestage": "resource",
    "pea": "pea",
    "preliminaryeconomic": "pea",
    "preliminaryeconomicassessment": "pea",
    "pfs": "pfs",
    "prefeasibility": "pfs",
    "prefeasibilitystudy": "pfs",
    "fs": "fs",
    "feasibility": "fs",
    "feasibilitystudy": "fs",
    "bfs": "fs",
    "bankablefeasibility": "fs",
    "permitting": "permitting",
    "permit": "permitting",
    "construction": "construction",
    "development": "construction",
    "production": "production",
    "operating": "production",
    "producer": "production",
    "caremaintenance": "care_maintenance",
    "careandmaintenance": "care_maintenance",
    "suspended": "care_maintenance",
}

_COUNTRY_ALIASES: dict[str, str] = {
    "us": "United States",
    "usa": "United States",
    "unitedstates": "United States",
    "unitedstatesofamerica": "United States",
    "america": "United States",
    "ca": "Canada",
    "canada": "Canada",
    "ar": "Argentina",
    "argentina": "Argentina",
    "au": "Australia",
    "aus": "Australia",
    "australia": "Australia",
    "mx": "Mexico",
    "mexico": "Mexico",
    "pe": "Peru",
    "peru": "Peru",
    "cl": "Chile",
    "chile": "Chile",
    "br": "Brazil",
    "brazil": "Brazil",
    "international": "International",
    "internationalwaters": "International",
}

_STUDY_ALIASES: dict[str, str] = {
    "pea": "pea",
    "preliminaryeconomic": "pea",
    "preliminaryeconomicassessment": "pea",
    "pfs": "pfs",
    "prefeasibility": "pfs",
    "prefeasibilitystudy": "pfs",
    "fs": "fs",
    "feasibility": "fs",
    "feasibilitystudy": "fs",
    "bfs": "fs",
    "bankable": "fs",
    "scoping": "scoping",
    "scopingsstudy": "scoping",
    "other": "other",
}

_STANDARD_ALIASES: dict[str, str] = {
    "sk1300": "SK-1300",
    "sk-1300": "SK-1300",
    "s-k1300": "SK-1300",
    "secsk1300": "SK-1300",
    "secs-k1300": "SK-1300",
    "ni43101": "NI43-101",
    "ni43-101": "NI43-101",
    "43101": "NI43-101",
    "jorc": "JORC",
}


def _token(value: str) -> str:
    return _NON_ALNUM.sub("", value.lower())


def normalize_project_name(name: str) -> str:
    cleaned = _PROJECT_NOISE.sub(" ", name.lower())
    cleaned = _NON_ALNUM.sub(" ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def is_company_named_project(project_name: str, company_name: str) -> bool:
    left = normalize_project_name(project_name)
    right = normalize_project_name(company_name)
    return bool(left) and left == right


def normalize_commodity(value: str) -> Optional[str]:
    token = _token(value)
    if not token:
        return None
    if token in _COMMODITY_ALIASES:
        return _COMMODITY_ALIASES[token]
    if len(value.strip()) <= 5 and value.strip()[0].isalpha():
        stripped = value.strip()
        if stripped[0].isupper() and stripped.isalnum():
            return stripped
    return value.strip()[:12]


def normalize_commodities(values: list[str]) -> list[str]:
    seen: list[str] = []
    for item in values:
        mapped = normalize_commodity(item)
        if mapped and mapped not in seen:
            seen.append(mapped)
    return seen


def normalize_stage(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    mapped = _STAGE_ALIASES.get(_token(value))
    return mapped


def normalize_country(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    mapped = _COUNTRY_ALIASES.get(_token(value))
    if mapped:
        return mapped
    text = value.strip()
    return text[:80] if text else None


def normalize_study_type(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    mapped = _STUDY_ALIASES.get(_token(value))
    if mapped in STUDY_TYPES:
        return mapped
    return "other"


def normalize_standard(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    mapped = _STANDARD_ALIASES.get(_token(value))
    if mapped in RESOURCE_STANDARDS:
        return mapped
    return None
