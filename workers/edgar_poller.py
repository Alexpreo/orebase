"""EDGAR poller: discover mining technical-report filings via SEC EDGAR full-text search,
download the primary document, dedupe by sha256, store in S3, record in raw.documents, and
enqueue a parse job.

SEC fair-access rules (https://www.sec.gov/os/webmaster-faq#developers):
  - <= 10 requests/second
  - a descriptive User-Agent that includes a contact email (from EDGAR_USER_AGENT)

The poller is idempotent: sha256 dedupe on the downloaded bytes plus the documents.sha256
unique constraint means a crashed/rerun poller never creates duplicate rows.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import httpx

from common.config import settings
from common.db import document_exists_by_sha256, enqueue_job, insert_document
from common.s3 import upload_pdf

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("edgar_poller")

EFTS_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:0>10}.json"

# SEC allows 10 req/s; keep a small safety margin.
MAX_REQUESTS_PER_SECOND = 8.0

# SIC 1000-1099 = metal mining. Default discovery query targets SK-1300 technical reports,
# which are filed as EX-96.x exhibits.
DEFAULT_QUERY = "technical report summary"
DEFAULT_SIC_MIN = 1000
DEFAULT_SIC_MAX = 1099


class RateLimiter:
    """Thread-safe minimum-interval limiter to stay under SEC's request ceiling."""

    def __init__(self, max_per_second: float) -> None:
        self._min_interval = 1.0 / max_per_second
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            if now < self._next_allowed:
                time.sleep(self._next_allowed - now)
            self._next_allowed = time.monotonic() + self._min_interval


@dataclass
class FilingHit:
    accession: str          # e.g. 0001234567-24-000123
    filename: str           # primary document filename within the filing
    cik: str
    form: str
    title: str
    filed_at: Optional[str]

    @property
    def external_id(self) -> str:
        return f"{self.accession}:{self.filename}"

    @property
    def primary_url(self) -> str:
        acc_nodash = self.accession.replace("-", "")
        return f"{ARCHIVES_BASE}/{int(self.cik)}/{acc_nodash}/{self.filename}"


class EdgarClient:
    def __init__(self) -> None:
        self._limiter = RateLimiter(MAX_REQUESTS_PER_SECOND)
        self._http = httpx.Client(
            headers={
                "User-Agent": settings.edgar_user_agent,
                "Accept-Encoding": "gzip, deflate",
            },
            timeout=30.0,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._http.close()

    def _get(self, url: str, params: Optional[dict[str, Any]] = None) -> httpx.Response:
        self._limiter.wait()
        resp = self._http.get(url, params=params)
        resp.raise_for_status()
        return resp

    def search(
        self,
        query: str,
        forms: Optional[str],
        date_from: Optional[str],
        date_to: Optional[str],
        from_offset: int,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"q": query, "from": from_offset}
        if forms:
            params["forms"] = forms
        if date_from:
            params["startdt"] = date_from
        if date_to:
            params["enddt"] = date_to
        return self._get(EFTS_SEARCH_URL, params=params).json()

    def company_sic(self, cik: str) -> Optional[int]:
        """Resolve a filer's SIC code via the submissions API (used to keep only miners)."""
        try:
            data = self._get(SUBMISSIONS_URL.format(cik=cik)).json()
        except httpx.HTTPError:
            return None
        sic = data.get("sic")
        try:
            return int(sic) if sic not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def download(self, url: str) -> bytes:
        return self._get(url).content


def _parse_hits(payload: dict[str, Any]) -> Iterable[FilingHit]:
    for hit in payload.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        raw_id = hit.get("_id", "")
        if ":" not in raw_id:
            continue
        accession, filename = raw_id.split(":", 1)
        ciks = source.get("ciks") or []
        if not ciks:
            continue
        display = source.get("display_names") or []
        yield FilingHit(
            accession=accession,
            filename=filename,
            cik=str(ciks[0]),
            form=source.get("root_forms", source.get("form", "")) or "",
            title=display[0] if display else (source.get("form") or "EDGAR filing"),
            filed_at=source.get("file_date"),
        )


def _doc_type_for_form(form: str) -> str:
    form = (form or "").upper()
    if "10-K" in form:
        return "financials"
    if "10-Q" in form:
        return "financials"
    if "8-K" in form:
        return "press_release"
    # SK-1300 technical report summaries arrive as EX-96 exhibits on various forms.
    return "sk1300"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def process_hit(client: EdgarClient, hit: FilingHit, sic_min: int, sic_max: int) -> str:
    """Return one of: 'skipped_sic' | 'skipped_dupe' | 'ingested' | 'error'."""
    sic = client.company_sic(hit.cik)
    if sic is not None and not (sic_min <= sic <= sic_max):
        return "skipped_sic"

    try:
        data = client.download(hit.primary_url)
    except httpx.HTTPError:
        logger.warning("download failed for %s", hit.primary_url)
        return "error"

    sha = _sha256(data)
    if document_exists_by_sha256(sha):
        return "skipped_dupe"

    key = f"edgar/{hit.cik}/{hit.accession}/{hit.filename}"
    storage_path = upload_pdf(data, key)

    document_id = insert_document(
        source="edgar",
        source_url=hit.primary_url,
        external_id=hit.external_id,
        doc_type=_doc_type_for_form(hit.form),
        title=hit.title,
        filed_at=hit.filed_at,
        sha256=sha,
        storage_path=storage_path,
        status="ingested",
    )
    if document_id is None:
        # Lost a race on the sha256 unique constraint; another worker ingested it first.
        return "skipped_dupe"

    enqueue_job(document_id, job_type="parse")
    return "ingested"


def run(
    limit: int,
    query: str,
    forms: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
    sic_min: int,
    sic_max: int,
) -> dict[str, int]:
    client = EdgarClient()
    counts = {"ingested": 0, "skipped_dupe": 0, "skipped_sic": 0, "error": 0, "seen": 0}
    try:
        from_offset = 0
        page_size = 10  # EDGAR full-text search returns 10 hits per page.
        while counts["seen"] < limit:
            payload = client.search(query, forms, date_from, date_to, from_offset)
            hits = list(_parse_hits(payload))

            if settings.debug:
                total = payload.get("hits", {}).get("total", {}).get("value")
                logger.info(
                    "[DEBUG] edgar.search q=%r forms=%r range=%s..%s from=%d "
                    "page_hits=%d total_available=%s",
                    query, forms, date_from, date_to, from_offset, len(hits), total,
                )

            if not hits:
                break

            for hit in hits:
                if counts["seen"] >= limit:
                    break
                counts["seen"] += 1
                counts[process_hit(client, hit, sic_min, sic_max)] += 1

            from_offset += page_size
    finally:
        client.close()

    if settings.debug:
        logger.info(
            "[DEBUG] edgar.run done ingested=%d skipped_dupe=%d skipped_sic=%d error=%d seen=%d",
            counts["ingested"], counts["skipped_dupe"], counts["skipped_sic"],
            counts["error"], counts["seen"],
        )
    logger.info("EDGAR poll complete: %s", counts)
    return counts


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Poll SEC EDGAR for mining technical reports.")
    parser.add_argument("--limit", type=int, default=20, help="max hits to inspect this run")
    parser.add_argument("--query", default=DEFAULT_QUERY, help="EDGAR full-text search query")
    parser.add_argument("--forms", default=None, help="comma-separated EDGAR form filter, e.g. '8-K,10-K'")
    parser.add_argument("--date-from", default=None, help="start filing date (YYYY-MM-DD)")
    parser.add_argument("--date-to", default=None, help="end filing date (YYYY-MM-DD)")
    parser.add_argument(
        "--sic",
        default=f"{DEFAULT_SIC_MIN}-{DEFAULT_SIC_MAX}",
        help="SIC code range 'min-max' to keep (default metal mining 1000-1099)",
    )
    return parser


def main() -> None:
    args = _build_arg_parser().parse_args()
    sic_min, sic_max = DEFAULT_SIC_MIN, DEFAULT_SIC_MAX
    if args.sic:
        parts = args.sic.split("-")
        sic_min = int(parts[0])
        sic_max = int(parts[1]) if len(parts) > 1 else sic_min
    run(
        limit=args.limit,
        query=args.query,
        forms=args.forms,
        date_from=args.date_from,
        date_to=args.date_to,
        sic_min=sic_min,
        sic_max=sic_max,
    )


if __name__ == "__main__":
    main()
