"""Drain sedar.pending_fetches through the Playwright session at a polite rate."""

from __future__ import annotations

import argparse
import hashlib
import logging
from datetime import date, datetime, timezone
from typing import Optional

from common.config import settings
from common.db import (
    connection,
    document_exists_by_external_id,
    document_exists_by_sha256,
    enqueue_job,
    insert_document,
)
from common.metrics import notify_challenge, put_documents_ingested
from common.s3 import PDF_CONTENT_TYPE, upload_object

from .ratelimit import ChallengeDetected, CircuitOpen
from .search import FilingResult
from .session import SedarSession, session

logger = logging.getLogger(__name__)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetched_today() -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*)::int AS n
              FROM sedar.pending_fetches
             WHERE status = 'fetched'
               AND created_at::date = CURRENT_DATE;
            """
        )
        row = cur.fetchone()
        return int(row["n"]) if row else 0


def enqueue_pending(filing: FilingResult, discovered_via: str) -> Optional[str]:
    ref = filing.download_url or filing.external_id
    if not ref:
        return None
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM sedar.pending_fetches
             WHERE external_ref = %s
             LIMIT 1;
            """,
            (ref,),
        )
        if cur.fetchone():
            return None
        if document_exists_by_external_id("sedar", filing.external_id):
            return None
        filed = None
        if filing.filed_at:
            try:
                filed = date.fromisoformat(filing.filed_at[:10])
            except ValueError:
                filed = None
        cur.execute(
            """
            INSERT INTO sedar.pending_fetches (
                source, issuer_profile, document_type, filed_date, external_ref,
                discovered_via, status
            ) VALUES ('sedar', %s, %s, %s, %s, %s, 'pending')
            RETURNING id;
            """,
            (
                filing.profile_number or filing.profile_name,
                filing.document_type_label,
                filed,
                ref,
                discovered_via,
            ),
        )
        row = cur.fetchone()
        return str(row["id"]) if row else None


def _mark(fetch_id: str, status: str, error: Optional[str] = None) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sedar.pending_fetches
               SET status = %s,
                   last_error = %s
             WHERE id = %s;
            """,
            (status, error, fetch_id),
        )


def _claim() -> Optional[dict]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sedar.pending_fetches AS f
               SET status = 'running',
                   attempts = f.attempts + 1
             WHERE f.id = (
                 SELECT id
                   FROM sedar.pending_fetches
                  WHERE status = 'pending'
                  ORDER BY created_at
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, issuer_profile, document_type, filed_date, external_ref, discovered_via;
            """
        )
        return cur.fetchone()


def _download(sess: SedarSession, url: str) -> bytes:
    page = sess.get_page()
    sess.limiter.wait()
    response = page.request.get(url)
    if response.status >= 400:
        raise RuntimeError(f"download HTTP {response.status}")
    body = response.body()
    content_type = (response.headers.get("content-type") or "").lower()
    if "html" in content_type and b"%PDF" not in body[:8]:
        raise RuntimeError("download returned HTML, not a PDF")
    return body


def ingest_bytes(
    *,
    data: bytes,
    filing_url: str,
    external_id: str,
    title: str,
    filed_at: Optional[date],
    doc_type: str,
) -> Optional[str]:
    sha = _sha256(data)
    if document_exists_by_sha256(sha) or document_exists_by_external_id("sedar", external_id):
        return None
    key = f"sedar/{datetime.now(timezone.utc).strftime('%Y/%m')}/{sha[:16]}.pdf"
    storage_path = upload_object(data, key, PDF_CONTENT_TYPE)
    document_id = insert_document(
        source="sedar",
        source_url=filing_url,
        external_id=external_id,
        doc_type=doc_type,
        title=title,
        filed_at=filed_at,
        sha256=sha,
        storage_path=storage_path,
        source_content_type=PDF_CONTENT_TYPE,
        status="ingested",
    )
    if document_id:
        enqueue_job(document_id, job_type="parse")
    return document_id


def process_one(sess: SedarSession, row: dict) -> str:
    from .config import map_doc_type

    url = row.get("external_ref") or ""
    if not url.startswith("http"):
        _mark(str(row["id"]), "failed", "no download URL on pending row")
        return "failed"
    try:
        data = _download(sess, url)
    except ChallengeDetected:
        _mark(str(row["id"]), "pending", "challenge")
        raise
    except Exception as exc:  # noqa: BLE001
        _mark(str(row["id"]), "failed", str(exc)[:2000])
        return "error"
    filed = row.get("filed_date")
    document_id = ingest_bytes(
        data=data,
        filing_url=url,
        external_id=url,
        title=row.get("document_type") or "SEDAR+ filing",
        filed_at=filed,
        doc_type=map_doc_type(row.get("document_type") or ""),
    )
    if document_id is None:
        _mark(str(row["id"]), "skipped_dupe")
        return "skipped_dupe"
    _mark(str(row["id"]), "fetched")
    return "fetched"


def drain(*, headful: bool, limit: int) -> dict[str, int]:
    counts = {"fetched": 0, "skipped_dupe": 0, "failed": 0, "error": 0, "skipped_cap": 0}
    already = fetched_today()
    cap = settings.sedar_daily_fetch_cap
    with session(headful=headful) as sess:
        for _ in range(limit):
            if already + counts["fetched"] >= cap:
                counts["skipped_cap"] += 1
                logger.info("daily SEDAR fetch cap %s reached", cap)
                break
            row = _claim()
            if row is None:
                break
            try:
                result = process_one(sess, row)
            except (ChallengeDetected, CircuitOpen) as exc:
                notify_challenge(str(exc))
                logger.error("SEDAR session stopped: %s", exc)
                break
            counts[result] = counts.get(result, 0) + 1
            if result == "fetched":
                put_documents_ingested("sedar", 1)
    return counts


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Fetch pending SEDAR+ documents.")
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    counts = drain(headful=args.headful, limit=args.limit)
    logger.info("sedar fetch %s", counts)


if __name__ == "__main__":
    main()
