"""EDGAR poller: discover mining technical-report filings via SEC EDGAR full-text search,
download the primary document, dedupe by sha256, store in S3, record in raw.documents, and
enqueue a parse job.

SK-1300 technical report summaries are filed as HTML exhibits rather than PDFs, so HTML is
stored as filed and additionally rendered to PDF: the PDF carries the page anchors that
citations point at, while the original markup keeps exact table structure for extraction.

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
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import httpx

from common.config import settings
from common.db import document_exists_by_sha256, enqueue_job, insert_document
from common.render import RENDER_ENGINE, html_to_pdf
from common.s3 import PDF_CONTENT_TYPE, upload_object

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("edgar_poller")

EFTS_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"

HTML_CONTENT_TYPE = "text/html"

# The search response carries the exhibit type the filer declared, which is authoritative.
# Filenames only sometimes encode it: `exhibit9621231202310-k.htm` and
# `ergominingconsolidatedtr.htm` are both real EX-96 exhibits that no `ex96` pattern catches,
# while `sodi_ex961.htm` is filed as EX-95.1. Filename is a fallback for a missing file_type.
_EX96_TYPE = re.compile(r"^ex-?96", re.IGNORECASE)
_EX96_FILENAME = re.compile(r"ex-?96", re.IGNORECASE)

# SEC allows 10 req/s; keep a small safety margin.
MAX_REQUESTS_PER_SECOND = 8.0

# EDGAR returns occasional 500s on valid requests; retry rather than abandon the run.
MAX_HTTP_ATTEMPTS = 4
HTTP_BACKOFF_BASE_SECONDS = 1.0

# SIC 1000-1099 = metal mining. Default discovery query targets SK-1300 technical reports,
# which are filed as EX-96.x exhibits.
DEFAULT_QUERY = "technical report summary"
DEFAULT_SIC_MIN = 1000
DEFAULT_SIC_MAX = 1099

# Full-text search cannot distinguish a technical report from a document that merely names
# one, so ~59% of hits for the default query are qualified-person consent letters and SEC
# correspondence. Those arrive under an open-ended set of exhibit types (EX-23, EX-15, but
# also EX-99, EX-17, CORRESP), so an allowlist of what to keep is durable where a blocklist
# of what to drop leaks with every new type a filer picks. Pass `all` to disable filtering.
DEFAULT_FILE_TYPES = "EX-96"
ALL_FILE_TYPES = "all"


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
    form: str               # root form the exhibit hangs off, e.g. 10-K
    file_type: str          # declared exhibit type, e.g. EX-96.1; "" when EDGAR omits it
    title: str
    filed_at: Optional[str]
    sic: Optional[int]      # from the search response; avoids a per-hit metadata request

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
        """GET with retry on transient upstream failures.

        EDGAR intermittently returns 500s and 503s on otherwise valid requests, so a single
        blip must not abort a whole poll run. Client errors (4xx) are not retried.
        """
        last_error: Optional[Exception] = None
        for attempt in range(MAX_HTTP_ATTEMPTS):
            self._limiter.wait()
            try:
                resp = self._http.get(url, params=params)
                resp.raise_for_status()
                return resp
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code < 500:
                    raise
                last_error = exc
            except httpx.TransportError as exc:
                last_error = exc

            if attempt < MAX_HTTP_ATTEMPTS - 1:
                time.sleep(HTTP_BACKOFF_BASE_SECONDS * (2**attempt))

        assert last_error is not None
        raise last_error

    def fetch_asset(self, url: str) -> Optional[tuple[bytes, str]]:
        """Fetch a figure or stylesheet for the renderer, or None if unavailable.

        Shares the poller's rate limiter so a figure-heavy filing cannot burst past SEC's
        ceiling. A missing figure degrades the rendered page; it must not fail the render,
        so every error resolves to None.
        """
        if not url.startswith(ARCHIVES_BASE):
            logger.debug("skipping off-archive asset %s", url)
            return None
        try:
            resp = self._get(url)
        except Exception as exc:  # noqa: BLE001 - a lost figure is not a lost document
            logger.warning("asset fetch failed for %s: %s", url, exc)
            return None
        content_type = resp.headers.get("content-type", "application/octet-stream")
        return resp.content, content_type.split(";")[0].strip()

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

    def download(self, url: str) -> bytes:
        return self._get(url).content


def _first_sic(source: dict[str, Any]) -> Optional[int]:
    for value in source.get("sics") or []:
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None


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
        root_forms = source.get("root_forms") or []
        yield FilingHit(
            accession=accession,
            filename=filename,
            cik=str(ciks[0]),
            form=(root_forms[0] if root_forms else source.get("form", "")) or "",
            file_type=(source.get("file_type") or "").strip(),
            title=display[0] if display else (source.get("form") or "EDGAR filing"),
            filed_at=source.get("file_date"),
            sic=_first_sic(source),
        )


def _is_technical_report(file_type: str, filename: str) -> bool:
    """True when the hit is an SK-1300 technical report summary (an EX-96.x exhibit)."""
    if file_type:
        return bool(_EX96_TYPE.match(file_type))
    return bool(_EX96_FILENAME.search(filename))


def _normalize_file_type(value: str) -> str:
    """Fold EDGAR's inconsistent hyphenation so 'EX-96' and 'ex96' compare equal."""
    return value.strip().upper().replace("-", "")


def parse_file_types(raw: Optional[str]) -> tuple[str, ...]:
    """Parse the allowlist into normalized prefixes. Empty tuple means keep everything."""
    if raw is None:
        raw = DEFAULT_FILE_TYPES
    if raw.strip().lower() in ("", ALL_FILE_TYPES):
        return ()
    return tuple(_normalize_file_type(part) for part in raw.split(",") if part.strip())


def _matches_file_types(hit: FilingHit, allowed: tuple[str, ...]) -> bool:
    """Whether a hit's declared exhibit type is in the allowlist.

    Matching is on whole segments, so 'EX-96' admits EX-96.1 but not EX-961 (a different
    exhibit). When EDGAR omits file_type the filename is the only signal available, and it
    reliably encodes EX-96 alone.
    """
    if not allowed:
        return True
    declared = _normalize_file_type(hit.file_type)
    if not declared:
        return "EX96" in allowed and bool(_EX96_FILENAME.search(hit.filename))
    return any(declared == a or declared.startswith(f"{a}.") for a in allowed)


def _doc_type_for(form: str, file_type: str, filename: str) -> str:
    """Classify by exhibit first, parent form second.

    SK-1300 technical report summaries are EX-96.x exhibits that hang off whatever form the
    filer happened to use (10-K, 20-F, 8-K, S-1). Classifying by parent form alone labels a
    technical report attached to an annual report as 'financials'.
    """
    if _is_technical_report(file_type, filename):
        return "sk1300"

    form = (form or "").upper()
    if any(f in form for f in ("10-K", "10-Q", "20-F", "40-F")):
        return "financials"
    if any(f in form for f in ("8-K", "6-K")):
        return "press_release"
    # Unrecognized form reached via a technical-report query: assume the query was right.
    return "sk1300"


def _content_type_for(filename: str) -> Optional[str]:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return PDF_CONTENT_TYPE
    if lower.endswith((".htm", ".html")):
        return HTML_CONTENT_TYPE
    return None


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def process_hit(
    client: EdgarClient,
    hit: FilingHit,
    sic_min: int,
    sic_max: int,
    file_types: tuple[str, ...],
) -> str:
    """Return one of: 'skipped_file_type' | 'skipped_sic' | 'skipped_unsupported' |
    'skipped_dupe' | 'ingested' | 'error'.
    """
    if not _matches_file_types(hit, file_types):
        return "skipped_file_type"

    # An EX-96 exhibit only exists because of SK-1300, which only applies to mining
    # registrants, so the exhibit type is better evidence than the filer's SIC code. Real
    # technical reports come from filers coded outside 1000-1099 (deep-sea miners land under
    # 4400, for instance), and dropping those on SIC alone loses genuine mining reports.
    is_technical_report = _is_technical_report(hit.file_type, hit.filename)

    # SIC comes from the search response, so filtering costs no extra request. A filing with
    # no SIC is kept rather than dropped: better a stray document than a missed miner.
    if not is_technical_report and hit.sic is not None:
        if not (sic_min <= hit.sic <= sic_max):
            return "skipped_sic"

    content_type = _content_type_for(hit.filename)
    if content_type is None:
        return "skipped_unsupported"

    try:
        data = client.download(hit.primary_url)
    except httpx.HTTPError:
        logger.warning("download failed for %s", hit.primary_url)
        return "error"

    # Dedupe on the bytes as filed, so re-rendering can never change a document's identity.
    sha = _sha256(data)
    if document_exists_by_sha256(sha):
        return "skipped_dupe"

    base_key = f"edgar/{hit.cik}/{hit.accession}/{hit.filename}"
    source_storage_path: Optional[str] = None
    render_engine: Optional[str] = None

    if content_type == PDF_CONTENT_TYPE:
        storage_path = upload_object(data, base_key, PDF_CONTENT_TYPE)
    else:
        # Keep the filing as-is, then render the artifact citations will point at.
        source_storage_path = upload_object(data, base_key, HTML_CONTENT_TYPE)
        try:
            pdf_bytes = html_to_pdf(
                data,
                base_url=hit.primary_url,
                user_agent=settings.edgar_user_agent,
                fetch_asset=client.fetch_asset,
            )
        except Exception as exc:  # noqa: BLE001 - render failures must not kill the poll
            logger.warning("HTML render failed for %s: %s", hit.primary_url, exc)
            return "error"
        storage_path = upload_object(pdf_bytes, f"{base_key}.pdf", PDF_CONTENT_TYPE)
        render_engine = RENDER_ENGINE

    document_id = insert_document(
        source="edgar",
        source_url=hit.primary_url,
        external_id=hit.external_id,
        doc_type=_doc_type_for(hit.form, hit.file_type, hit.filename),
        title=hit.title,
        filed_at=hit.filed_at,
        sha256=sha,
        storage_path=storage_path,
        source_storage_path=source_storage_path,
        source_content_type=content_type,
        render_engine=render_engine,
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
    file_types: tuple[str, ...] = (),
) -> dict[str, int]:
    client = EdgarClient()
    counts = {
        "ingested": 0,
        "skipped_dupe": 0,
        "skipped_file_type": 0,
        "skipped_sic": 0,
        "skipped_unsupported": 0,
        "error": 0,
        "seen": 0,
    }
    try:
        from_offset = 0
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
                counts[process_hit(client, hit, sic_min, sic_max, file_types)] += 1

            # Advance by what EDGAR actually returned. The page size is not part of the
            # documented contract, and assuming a smaller one re-walks hits already
            # processed, paying a download each time before sha256 dedupe rejects them.
            from_offset += len(hits)
    finally:
        client.close()

    if settings.debug:
        logger.info(
            "[DEBUG] edgar.run done file_types=%s ingested=%d skipped_dupe=%d "
            "skipped_file_type=%d skipped_sic=%d skipped_unsupported=%d error=%d seen=%d",
            file_types or ALL_FILE_TYPES,
            counts["ingested"], counts["skipped_dupe"], counts["skipped_file_type"],
            counts["skipped_sic"], counts["skipped_unsupported"], counts["error"],
            counts["seen"],
        )
    logger.info("EDGAR poll complete: %s", counts)
    if counts["ingested"]:
        from common.metrics import put_documents_ingested

        put_documents_ingested("edgar", counts["ingested"])
    from common.metrics import emit_freshness

    emit_freshness("edgar")
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
    parser.add_argument(
        "--file-types",
        default=DEFAULT_FILE_TYPES,
        help=(
            f"comma-separated exhibit types to ingest, e.g. 'EX-96,EX-99' "
            f"(default {DEFAULT_FILE_TYPES}; pass '{ALL_FILE_TYPES}' to keep every type)"
        ),
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
        file_types=parse_file_types(args.file_types),
    )


if __name__ == "__main__":
    main()
