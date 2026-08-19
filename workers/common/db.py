"""Postgres access helpers: a shared connection pool, a job-claim primitive, and small
insert/update helpers used by the pollers and the processor."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator, Optional

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
            min_size=1,
            max_size=10,
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
    """
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
            SELECT id, source, source_url, storage_path, sha256, doc_type, status, page_count
              FROM raw.documents
             WHERE id = %s;
            """,
            (document_id,),
        )
        return cur.fetchone()


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
