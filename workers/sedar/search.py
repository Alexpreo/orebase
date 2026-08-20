"""SEDAR+ document search: JSON replay (Path 1) with DOM fallback (Path 2)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional
from urllib.parse import urljoin

from playwright.sync_api import Page

from common.config import settings

from .config import DEFAULT_SEARCH_URL, map_doc_type
from .ratelimit import ChallengeDetected
from .session import SedarSession, detect_challenge

logger = logging.getLogger(__name__)

# Filled from NOTES.md after the discovery hour. Empty means Path 1 is skipped.
JSON_SEARCH_URL = ""


@dataclass
class FilingResult:
    profile_name: str
    profile_number: Optional[str]
    document_name: str
    filed_at: Optional[str]
    jurisdiction: Optional[str]
    download_url: Optional[str]
    external_id: str
    doc_type: str
    document_type_label: str


def _absolute(url: Optional[str], page: Page) -> Optional[str]:
    if not url:
        return None
    if url.startswith("http"):
        return url
    return urljoin(page.url, url)


class JsonSearch:
    """Replay the internal search JSON from inside the browser context."""

    def __init__(self, session: SedarSession) -> None:
        self.session = session

    def enabled(self) -> bool:
        return bool(JSON_SEARCH_URL)

    def search(
        self,
        *,
        document_type: str,
        date_from: date,
        date_to: date,
        offset: int = 0,
    ) -> list[FilingResult]:
        if not self.enabled():
            raise RuntimeError("JSON_SEARCH_URL is not set; Path 1 is disabled")
        page = self.session.get_page()
        self.session.limiter.wait()
        response = page.request.post(
            JSON_SEARCH_URL,
            data={
                "documentType": document_type,
                "fromDate": date_from.isoformat(),
                "toDate": date_to.isoformat(),
                "offset": offset,
            },
        )
        if response.status in {401, 403, 429} or "html" in (response.headers.get("content-type") or ""):
            self.session.limiter.record_challenge()
            raise ChallengeDetected(f"JSON search status {response.status}")
        payload = response.json()
        rows = payload.get("results") or payload.get("items") or []
        return [_from_json(row) for row in rows if isinstance(row, dict)]


def _from_json(row: dict) -> FilingResult:
    name = str(row.get("document_name") or row.get("documentName") or "filing")
    profile = str(row.get("profile") or row.get("profileName") or "")
    guid = str(row.get("id") or row.get("guid") or row.get("download_url") or name)
    label = str(row.get("document_type") or row.get("documentType") or name)
    return FilingResult(
        profile_name=profile,
        profile_number=str(row["profile_number"]) if row.get("profile_number") else None,
        document_name=name,
        filed_at=str(row.get("submitted_date") or row.get("filed_at") or "") or None,
        jurisdiction=str(row.get("jurisdiction") or "") or None,
        download_url=str(row.get("download_url") or row.get("url") or "") or None,
        external_id=guid,
        doc_type=map_doc_type(label),
        document_type_label=label,
    )


class DomSearch:
    """Drive the public search form and scrape the results table."""

    def __init__(self, session: SedarSession) -> None:
        self.session = session

    def search(
        self,
        *,
        document_type: str,
        date_from: date,
        date_to: date,
    ) -> list[FilingResult]:
        page = self.session.goto(settings.sedar_search_url or DEFAULT_SEARCH_URL)
        detect_challenge(page)
        self._fill(page, document_type, date_from, date_to)
        self.session.limiter.wait()
        page.get_by_role("button", name="Search").first.click()
        page.wait_for_timeout(2_000)
        detect_challenge(page)
        return self._parse_table(page)

    def _fill(self, page: Page, document_type: str, date_from: date, date_to: date) -> None:
        type_box = page.get_by_label("Document type", exact=False)
        if type_box.count():
            type_box.first.fill(document_type)
        dates = page.locator("input[type='date']")
        if dates.count() >= 2:
            dates.nth(0).fill(date_from.isoformat())
            dates.nth(1).fill(date_to.isoformat())

    def _parse_table(self, page: Page) -> list[FilingResult]:
        rows = page.locator("table tbody tr")
        count = rows.count()
        results: list[FilingResult] = []
        for index in range(count):
            row = rows.nth(index)
            cells = row.locator("td")
            if cells.count() < 3:
                continue
            profile = cells.nth(0).inner_text().strip()
            document_name = cells.nth(1).inner_text().strip()
            filed = cells.nth(2).inner_text().strip()
            jurisdiction = cells.nth(3).inner_text().strip() if cells.count() > 3 else ""
            link = row.locator("a[href*='resource.html']").first
            href = _absolute(link.get_attribute("href") if link.count() else None, page)
            external = href or f"{profile}:{document_name}:{filed}"
            results.append(
                FilingResult(
                    profile_name=profile,
                    profile_number=_profile_number(profile),
                    document_name=document_name,
                    filed_at=_parse_filed(filed),
                    jurisdiction=jurisdiction or None,
                    download_url=href,
                    external_id=external,
                    doc_type=map_doc_type(document_name),
                    document_type_label=document_name,
                )
            )
        logger.info("DomSearch parsed %d rows", len(results))
        return results


def _profile_number(profile: str) -> Optional[str]:
    start = profile.rfind("(")
    end = profile.rfind(")")
    if start >= 0 and end > start:
        return profile[start + 1 : end].strip()
    return None


def _parse_filed(text: str) -> Optional[str]:
    token = text.strip()[:10]
    if len(token) >= 10 and token[4] == "-":
        return token
    return None


def search_filings(
    session: SedarSession,
    *,
    document_type: str,
    date_from: date,
    date_to: date,
) -> list[FilingResult]:
    json_search = JsonSearch(session)
    if json_search.enabled():
        try:
            return json_search.search(
                document_type=document_type, date_from=date_from, date_to=date_to
            )
        except Exception as exc:  # noqa: BLE001 - fall back to DOM
            logger.warning("Path 1 JSON search failed (%s); using DOM", exc)
    return DomSearch(session).search(
        document_type=document_type, date_from=date_from, date_to=date_to
    )
