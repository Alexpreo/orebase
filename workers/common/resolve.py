"""Resolve a filing to core.companies / core.projects before any fact rows are written."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from psycopg.types.json import Jsonb

from .db import connection, update_document_entities
from .extract_schemas import TriageResult
from .normalize import (
    is_company_named_project,
    normalize_commodities,
    normalize_country,
    normalize_project_name,
    normalize_stage,
)

logger = logging.getLogger(__name__)

_CIK_TITLE = re.compile(r"CIK\s+(\d{1,10})", re.IGNORECASE)
_CIK_PATH = re.compile(r"edgar/(\d{1,10})/")
_TITLE_PARTS = re.compile(
    r"^(?P<name>.+?)(?:\s+\((?P<ticker>[A-Z][A-Z0-9.]{0,6})\))?\s*(?:\(CIK\s+(?P<cik>\d+)\))?\s*$",
    re.IGNORECASE,
)


def parse_cik(doc: dict[str, Any]) -> Optional[str]:
    title = doc.get("title") or ""
    match = _CIK_TITLE.search(title)
    if match:
        return match.group(1).zfill(10)[-10:]
    for field in (doc.get("storage_path") or "", doc.get("source_storage_path") or ""):
        path_match = _CIK_PATH.search(field)
        if path_match:
            return path_match.group(1).zfill(10)[-10:]
    return None


def parse_title_company(title: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if not title:
        return None, None, None
    match = _TITLE_PARTS.match(title.strip())
    if not match:
        return title.strip() or None, None, None
    name = (match.group("name") or "").strip() or None
    ticker = match.group("ticker")
    cik = match.group("cik")
    return name, ticker, cik.zfill(10)[-10:] if cik else None


def _tickers_json(ticker: Optional[str]) -> Optional[Jsonb]:
    if not ticker:
        return None
    return Jsonb([{"exchange": "US", "symbol": ticker.upper()}])


def upsert_company(
    *,
    name: str,
    cik: Optional[str],
    ticker: Optional[str],
) -> str:
    with connection() as conn, conn.cursor() as cur:
        if cik:
            cur.execute("SELECT id FROM core.companies WHERE cik = %s LIMIT 1;", (cik,))
            existing = cur.fetchone()
            if existing:
                company_id = str(existing["id"])
                cur.execute(
                    """
                    UPDATE core.companies
                       SET name = COALESCE(NULLIF(%s, ''), name),
                           tickers = COALESCE(tickers, %s)
                     WHERE id = %s;
                    """,
                    (name, _tickers_json(ticker), company_id),
                )
                return company_id
        cur.execute(
            """
            SELECT id FROM core.companies
             WHERE lower(name) = lower(%s)
             LIMIT 2;
            """,
            (name,),
        )
        matches = cur.fetchall()
        if len(matches) == 1:
            company_id = str(matches[0]["id"])
            if cik:
                cur.execute(
                    "UPDATE core.companies SET cik = COALESCE(cik, %s) WHERE id = %s;",
                    (cik, company_id),
                )
            return company_id
        if len(matches) > 1:
            raise RuntimeError(f"ambiguous company name {name!r}; not creating a duplicate")
        cur.execute(
            """
            INSERT INTO core.companies (name, cik, tickers)
            VALUES (%s, %s, %s)
            RETURNING id;
            """,
            (name, cik, _tickers_json(ticker)),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError("failed to insert company")
        return str(row["id"])


def upsert_project(
    *,
    company_id: str,
    company_name: str,
    name: Optional[str],
    country: Optional[str],
    region: Optional[str],
    commodities: list[str],
    stage: Optional[str],
) -> Optional[str]:
    if not name or not name.strip():
        logger.warning("empty project name; leaving document unlinked")
        return None
    if is_company_named_project(name, company_name):
        logger.warning(
            "refusing company-named project %r for %r; leaving unlinked",
            name,
            company_name,
        )
        return None
    normalized = normalize_project_name(name)
    if not normalized:
        logger.warning("empty normalized project name from %r; skipping project create", name)
        return None
    country = normalize_country(country)
    stage = normalize_stage(stage)
    commodities = normalize_commodities(commodities)
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name
              FROM core.projects
             WHERE company_id = %s;
            """,
            (company_id,),
        )
        matches = [
            row
            for row in cur.fetchall()
            if normalize_project_name(row["name"]) == normalized
        ]
        if len(matches) > 1:
            logger.warning(
                "ambiguous project %r for company %s (%d matches); leaving unlinked",
                name, company_id, len(matches),
            )
            return None
        if len(matches) == 1:
            project_id = str(matches[0]["id"])
            cur.execute(
                """
                UPDATE core.projects
                   SET country = COALESCE(country, %s),
                       region = COALESCE(region, %s),
                       commodities = CASE
                         WHEN commodities IS NULL OR cardinality(commodities) = 0 THEN %s
                         ELSE commodities
                       END,
                       stage = COALESCE(stage, %s),
                       updated_at = now()
                 WHERE id = %s;
                """,
                (country, region, commodities or None, stage, project_id),
            )
            return project_id
        cur.execute(
            """
            INSERT INTO core.projects (company_id, name, country, region, commodities, stage)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (company_id, name.strip(), country, region, commodities or None, stage),
        )
        row = cur.fetchone()
        return str(row["id"]) if row else None


def resolve_document(doc: dict[str, Any], triage: TriageResult) -> tuple[Optional[str], Optional[str]]:
    """Create or match company + project, then stamp them on the document row."""
    title_name, title_ticker, title_cik = parse_title_company(doc.get("title"))
    cik = triage.cik or title_cik or parse_cik(doc)
    name = triage.company_name or title_name or "Unknown company"
    ticker = triage.ticker or title_ticker
    company_id = upsert_company(name=name, cik=cik, ticker=ticker)
    project_id = None
    if triage.project_name:
        project_id = upsert_project(
            company_id=company_id,
            company_name=name,
            name=triage.project_name,
            country=triage.country,
            region=triage.region,
            commodities=triage.commodities,
            stage=triage.stage,
        )
    update_document_entities(
        str(doc["id"]),
        company_id=company_id,
        project_id=project_id,
        summary=triage.summary[:500],
    )
    return company_id, project_id
