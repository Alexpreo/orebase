"""Postgres access helpers: a shared connection pool, a job-claim primitive, and small
insert/update helpers used by the pollers and the processor."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from decimal import Decimal
from typing import Any, Iterator, Literal, Optional

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

logger = logging.getLogger(__name__)

# search_path spans every schema so callers can use bare table names when convenient
# while still being explicit (raw./core./app./sedar.) in the hot paths.
#
# No spaces: this is passed through the libpq `options` connection parameter, which splits
# on whitespace. "raw, core" would arrive at the server as search_path="raw," and be
# rejected outright, so the list has to be a single whitespace-free token.
_SEARCH_PATH = "raw,core,app,sedar,public"

_pool: Optional[ConnectionPool] = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is not set; cannot open a connection pool.")
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=0,
            max_size=10,
            check=ConnectionPool.check_connection,
            kwargs={"row_factory": dict_row, "options": f"-c search_path={_SEARCH_PATH}"},
            open=True,
        )
    return _pool


@contextmanager
def connection() -> Iterator[Any]:
    """Borrow a pooled connection. Commits on success, rolls back on error."""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


def claim_job(job_type: str = "parse") -> Optional[dict[str, Any]]:
    """Atomically claim one pending job of the given type.

    SELECT ... FOR UPDATE SKIP LOCKED lets multiple processor instances pull disjoint
    jobs concurrently without blocking each other or double-processing a row.
    Extract jobs prefer explicit full_extract, then watchlisted filings, then newest.
    """
    if job_type in {"extract", "full_extract"}:
        return _claim_extract_job()
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE raw.processing_jobs AS j
               SET status = 'running',
                   attempts = j.attempts + 1,
                   updated_at = now()
             WHERE j.id = (
                 SELECT id
                   FROM raw.processing_jobs
                  WHERE status = 'pending'
                    AND job_type = %s
                  ORDER BY created_at
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING j.id, j.document_id, j.job_type, j.status, j.attempts, j.last_error;
            """,
            (job_type,),
        )
        return cur.fetchone()


def _claim_extract_job() -> Optional[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE raw.processing_jobs AS j
               SET status = 'running',
                   attempts = j.attempts + 1,
                   updated_at = now()
             WHERE j.id = (
                 SELECT j2.id
                   FROM raw.processing_jobs j2
                   JOIN raw.documents d ON d.id = j2.document_id
                  WHERE j2.status = 'pending'
                    AND j2.job_type IN ('extract', 'full_extract')
                  ORDER BY
                    (j2.job_type = 'full_extract') DESC,
                    EXISTS (
                        SELECT 1
                          FROM app.watchlist_items wi
                         WHERE wi.project_id = d.project_id
                            OR wi.company_id = d.company_id
                    ) DESC,
                    d.filed_at DESC NULLS LAST,
                    j2.created_at
                  FOR UPDATE OF j2 SKIP LOCKED
                  LIMIT 1
             )
         RETURNING j.id, j.document_id, j.job_type, j.status, j.attempts, j.last_error;
            """
        )
        return cur.fetchone()


def document_on_watchlist(document_id: str) -> bool:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
              FROM raw.documents d
             WHERE d.id = %s
               AND EXISTS (
                    SELECT 1
                      FROM app.watchlist_items wi
                     WHERE wi.project_id = d.project_id
                        OR wi.company_id = d.company_id
               )
             LIMIT 1;
            """,
            (document_id,),
        )
        return cur.fetchone() is not None


def complete_job(job_id: str, status: str = "done", last_error: Optional[str] = None) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE raw.processing_jobs
               SET status = %s, last_error = %s, updated_at = now()
             WHERE id = %s;
            """,
            (status, last_error, job_id),
        )


def enqueue_job(document_id: str, job_type: str = "parse") -> Optional[str]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw.processing_jobs (document_id, job_type, status)
            VALUES (%s, %s, 'pending')
            RETURNING id;
            """,
            (document_id, job_type),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def document_exists_by_sha256(sha256: str) -> bool:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM raw.documents WHERE sha256 = %s LIMIT 1;", (sha256,))
        return cur.fetchone() is not None


def document_exists_by_external_id(source: str, external_id: str) -> bool:
    if not external_id:
        return False
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM raw.documents
             WHERE source = %s AND external_id = %s
             LIMIT 1;
            """,
            (source, external_id),
        )
        return cur.fetchone() is not None


def insert_document(**fields: Any) -> Optional[str]:
    """Insert a raw.documents row. On sha256 conflict, no row is inserted (idempotent)."""
    columns = list(fields.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    col_sql = ", ".join(columns)
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO raw.documents ({col_sql})
            VALUES ({placeholders})
            ON CONFLICT (sha256) DO NOTHING
            RETURNING id;
            """,
            tuple(fields.values()),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def set_document_status(document_id: str, status: str, page_count: Optional[int] = None) -> None:
    with connection() as conn, conn.cursor() as cur:
        if page_count is None:
            cur.execute(
                "UPDATE raw.documents SET status = %s WHERE id = %s;",
                (status, document_id),
            )
        else:
            cur.execute(
                "UPDATE raw.documents SET status = %s, page_count = %s WHERE id = %s;",
                (status, page_count, document_id),
            )


def get_document(document_id: str) -> Optional[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, source, source_url, external_id, storage_path, source_storage_path,
                   source_content_type, sha256, doc_type, status, page_count, title,
                   filed_at, company_id, project_id, summary, render_engine
              FROM raw.documents
             WHERE id = %s;
            """,
            (document_id,),
        )
        return cur.fetchone()


def get_document_chunks(document_id: str) -> list[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, chunk_index, page_start, page_end, content, section_title
              FROM raw.document_chunks
             WHERE document_id = %s
             ORDER BY chunk_index;
            """,
            (document_id,),
        )
        return list(cur.fetchall())


def extraction_spend_usd(period: Literal["day", "month"]) -> Decimal:
    trunc = "day" if period == "day" else "month"
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COALESCE(sum(cost_usd), 0) AS spent
              FROM app.extraction_costs
             WHERE created_at >= date_trunc('{trunc}', now());
            """
        )
        row = cur.fetchone()
        return Decimal(str(row["spent"])) if row else Decimal("0")


class ExtractionCapExceeded(RuntimeError):
    """Raised when daily or monthly extraction spend is at the configured cap."""


def assert_extraction_cap() -> None:
    """Refuse new extract work once either dollar cap is hit. Call before claiming."""
    daily = extraction_spend_usd("day")
    monthly = extraction_spend_usd("month")
    daily_cap = Decimal(str(settings.extraction_daily_cap_usd))
    monthly_cap = Decimal(str(settings.extraction_monthly_cap_usd))
    if daily >= daily_cap:
        raise ExtractionCapExceeded(
            f"daily extraction cap hit (${daily} >= ${daily_cap})"
        )
    if monthly >= monthly_cap:
        raise ExtractionCapExceeded(
            f"monthly extraction cap hit (${monthly} >= ${monthly_cap})"
        )


def insert_extraction_cost(
    *,
    document_id: Optional[str],
    model: str,
    purpose: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_creation_tokens: int,
    cost_usd: Decimal,
) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.extraction_costs (
                document_id, model, purpose, input_tokens, output_tokens,
                cache_read_tokens, cache_creation_tokens, cost_usd
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
            """,
            (
                document_id,
                model,
                purpose,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                cost_usd,
            ),
        )


def update_document_entities(
    document_id: str,
    *,
    company_id: Optional[str] = None,
    project_id: Optional[str] = None,
    summary: Optional[str] = None,
) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE raw.documents
               SET company_id = COALESCE(%s, company_id),
                   project_id = COALESCE(%s, project_id),
                   summary = COALESCE(%s, summary)
             WHERE id = %s;
            """,
            (company_id, project_id, summary, document_id),
        )


def enqueue_job_if_absent(document_id: str, job_type: str) -> Optional[str]:
    """Enqueue only when no pending, running, or done job of this type exists."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw.processing_jobs (document_id, job_type, status)
            SELECT %s, %s, 'pending'
             WHERE NOT EXISTS (
                SELECT 1
                  FROM raw.processing_jobs
                 WHERE document_id = %s
                   AND job_type = %s
                   AND status IN ('pending', 'running', 'done')
             )
            RETURNING id;
            """,
            (document_id, job_type, document_id, job_type),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def list_pending_jobs(job_type: str) -> list[dict[str, Any]]:
    types = ("extract", "full_extract") if job_type == "extract" else (job_type,)
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, document_id, job_type, status, attempts, last_error
              FROM raw.processing_jobs
             WHERE status = 'pending'
               AND job_type = ANY(%s)
             ORDER BY created_at;
            """,
            (list(types),),
        )
        return list(cur.fetchall())


def enqueue_full_extract(document_id: str) -> Optional[str]:
    """Queue a forced numeric extract even if a triage extract job already completed."""
    return enqueue_job_if_absent(document_id, "full_extract")


def enqueue_extract_for_indexed() -> int:
    """Enqueue extract jobs for indexed documents that have never been extracted.

    Already-extracted documents are left alone; re-run a specific filing with
    `extractor.py --document-id` instead of this backfill.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw.processing_jobs (document_id, job_type, status)
            SELECT d.id, 'extract', 'pending'
              FROM raw.documents d
             WHERE d.status = 'indexed'
               AND NOT EXISTS (
                    SELECT 1
                      FROM raw.processing_jobs j
                     WHERE j.document_id = d.id
                       AND j.job_type = 'extract'
                       AND j.status IN ('pending', 'running', 'done')
               );
            """
        )
        return cur.rowcount or 0


def _vector_literal(embedding: list[float]) -> str:
    """pgvector accepts a text literal like '[0.1,0.2,...]' cast to ::vector."""
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


def replace_document_chunks(document_id: str, chunks: list[dict[str, Any]]) -> int:
    """Idempotently (re)write all chunks for a document. Returns the number written."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM raw.document_chunks WHERE document_id = %s;", (document_id,))
        for chunk in chunks:
            cur.execute(
                """
                INSERT INTO raw.document_chunks
                    (document_id, chunk_index, page_start, page_end, content, section_title, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s::vector);
                """,
                (
                    document_id,
                    chunk["chunk_index"],
                    chunk.get("page_start"),
                    chunk.get("page_end"),
                    chunk["content"],
                    chunk.get("section_title"),
                    _vector_literal(chunk["embedding"]),
                ),
            )
        return len(chunks)


def queue_depth(job_type: str = "parse") -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM raw.processing_jobs WHERE status = 'pending' AND job_type = %s;",
            (job_type,),
        )
        row = cur.fetchone()
        return int(row["n"]) if row else 0
