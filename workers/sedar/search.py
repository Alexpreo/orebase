"""SEDAR+ document search: JSON replay (Path 1) with DOM fallback (Path 2)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional
from urllib.parse import urljoin

from playwright.sync_api import Page

from common.config import settings

from .config import DEFAULT_SEARCH_URL, map_doc_type
from .ratelimit import ChallengeDetected
from .session import SedarSession

logger = logging.getLogger(__name__)


class SearchContractError(RuntimeError):
    """Path 1/2 response did not match the documented contract. Stop rather than invent rows."""


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


def _json_search_url() -> str:
    return (settings.sedar_json_search_url or "").strip()


class JsonSearch:
    """Replay the internal search JSON from inside the browser context."""

    def __init__(self, session: SedarSession) -> None:
        self.session = session

    def enabled(self) -> bool:
        return bool(_json_search_url())

    def search(
        self,
        *,
        document_type: str,
        date_from: date,
        date_to: date,
        offset: int = 0,
    ) -> list[FilingResult]:
        if not self.enabled():
            raise RuntimeError("SEDAR_JSON_SEARCH_URL is not set; Path 1 is disabled")
        page = self.session.get_page()
        self.session.limiter.wait()
        url = _json_search_url()
        body = _json_body(document_type, date_from, date_to, offset)
        method = (settings.sedar_json_search_method or "POST").upper()
        if method == "GET":
            response = page.request.get(url, params=body)
        else:
            response = page.request.post(url, data=body)
        if response.status in {401, 403, 429} or "html" in (response.headers.get("content-type") or ""):
            self.session.limiter.record_challenge()
            raise ChallengeDetected(f"JSON search status {response.status}")
        try:
            payload = response.json()
        except Exception as exc:  # noqa: BLE001
            raise SearchContractError(f"JSON search did not return JSON: {exc}") from exc
        rows = _result_rows(payload)
        parsed = [_from_json(row) for row in rows if isinstance(row, dict)]
        if rows and not parsed:
            raise SearchContractError("JSON search rows could not be mapped to FilingResult")
        return parsed


def _json_body(document_type: str, date_from: date, date_to: date, offset: int) -> dict[str, Any]:
    template = (settings.sedar_json_search_body or "").strip()
    values = {
        "document_type": document_type,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "offset": str(offset),
    }
    if template:
        filled = template
        for key, value in values.items():
            filled = filled.replace("{" + key + "}", value)
        try:
            payload = json.loads(filled)
        except json.JSONDecodeError as exc:
            raise SearchContractError(f"SEDAR_JSON_SEARCH_BODY is not JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise SearchContractError("SEDAR_JSON_SEARCH_BODY must be a JSON object")
        return payload
    return {
        "documentType": document_type,
        "fromDate": date_from.isoformat(),
        "toDate": date_to.isoformat(),
        "offset": offset,
    }


def _result_rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise SearchContractError("JSON search payload is not an object or array")
    for key in ("results", "items", "data", "documents", "rows"):
        rows = payload.get(key)
        if isinstance(rows, list):
            return rows
    raise SearchContractError("JSON search payload has no results/items/data array")


def _from_json(row: dict) -> FilingResult:
    name = str(row.get("document_name") or row.get("documentName") or "").strip()
    if not name:
        raise SearchContractError(f"JSON row missing document name: {list(row)[:12]}")
    profile = str(row.get("profile") or row.get("profileName") or row.get("issuer") or "")
    guid = str(row.get("id") or row.get("guid") or row.get("download_url") or name)
    label = str(row.get("document_type") or row.get("documentType") or name)
    return FilingResult(
        profile_name=profile,
        profile_number=(
            str(row["profile_number"])
            if row.get("profile_number")
            else str(row["profileNumber"]) if row.get("profileNumber") else _profile_number(profile)
        ),
        document_name=name,
        filed_at=str(row.get("submitted_date") or row.get("filed_at") or row.get("submittedDate") or "")
        or None,
        jurisdiction=str(row.get("jurisdiction") or "") or None,
        download_url=str(row.get("download_url") or row.get("url") or row.get("downloadUrl") or "")
        or None,
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
        self.session.detect_challenge(page)
        self._fill(page, document_type, date_from, date_to)
        self.session.limiter.wait()
        search_btn = page.get_by_role("button", name="Search")
        if search_btn.count() == 0:
            raise SearchContractError("DOM search: no Search button")
        search_btn.first.click()
        page.wait_for_timeout(2_000)
        self.session.detect_challenge(page)
        return self._parse_table(page)

    def next_page(self, page: Page) -> bool:
        nxt = page.get_by_role("button", name="Next")
        if nxt.count() == 0:
            nxt = page.get_by_role("link", name="Next")
        if nxt.count() == 0:
            return False
        control = nxt.first
        if control.get_attribute("disabled") is not None or control.get_attribute("aria-disabled") == "true":
            return False
        self.session.limiter.wait_between_pages()
        control.click()
        page.wait_for_timeout(2_000)
        self.session.detect_challenge(page)
        return True

    def _fill(self, page: Page, document_type: str, date_from: date, date_to: date) -> None:
        type_box = page.get_by_label("Document type", exact=False)
        if type_box.count() == 0:
            raise SearchContractError("DOM search: no Document type field")
        type_box.first.fill(document_type)
        dates = page.locator("input[type='date']")
        if dates.count() < 2:
            raise SearchContractError("DOM search: expected two date inputs")
        dates.nth(0).fill(date_from.isoformat())
        dates.nth(1).fill(date_to.isoformat())

    def _parse_table(self, page: Page) -> list[FilingResult]:
        table = page.locator("table").filter(has_text="Submitted date")
        target = table.first if table.count() else page.locator("table").first
        if target.count() == 0:
            raise SearchContractError("DOM search: no results table")
        rows = target.locator("tbody tr")
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
    paginate: bool = True,
    start_offset: int = 0,
    on_page: Optional[Any] = None,
) -> list[FilingResult]:
    json_search = JsonSearch(session)
    if json_search.enabled():
        try:
            return _paginate_json(
                json_search,
                document_type=document_type,
                date_from=date_from,
                date_to=date_to,
                paginate=paginate,
                start_offset=start_offset,
                on_page=on_page,
            )
        except SearchContractError:
            raise
        except ChallengeDetected:
            raise
        except Exception as exc:  # noqa: BLE001 - fall back to DOM
            logger.warning("Path 1 JSON search failed (%s); using DOM", exc)
    return _paginate_dom(
        session,
        document_type=document_type,
        date_from=date_from,
        date_to=date_to,
        paginate=paginate,
        on_page=on_page,
    )


def _paginate_json(
    json_search: JsonSearch,
    *,
    document_type: str,
    date_from: date,
    date_to: date,
    paginate: bool,
    start_offset: int,
    on_page: Optional[Any],
) -> list[FilingResult]:
    page_size = max(1, settings.sedar_page_size)
    offset = start_offset
    collected: list[FilingResult] = []
    while True:
        page_rows = json_search.search(
            document_type=document_type,
            date_from=date_from,
            date_to=date_to,
            offset=offset,
        )
        collected.extend(page_rows)
        if on_page:
            on_page(offset, page_rows)
        if not paginate or len(page_rows) < page_size:
            break
        offset += len(page_rows)
        json_search.session.limiter.wait_between_pages()
    return collected


def _paginate_dom(
    session: SedarSession,
    *,
    document_type: str,
    date_from: date,
    date_to: date,
    paginate: bool,
    on_page: Optional[Any],
) -> list[FilingResult]:
    dom = DomSearch(session)
    first = dom.search(document_type=document_type, date_from=date_from, date_to=date_to)
    collected = list(first)
    if on_page:
        on_page(0, first)
    if not paginate:
        return collected
    page = session.get_page()
    page_index = 1
    while dom.next_page(page):
        rows = dom._parse_table(page)
        collected.extend(rows)
        if on_page:
            on_page(page_index, rows)
        if not rows:
            break
        page_index += 1
    return collected
