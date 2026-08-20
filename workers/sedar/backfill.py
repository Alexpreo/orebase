"""Historical SEDAR+ harvest. Opt-in only.

Do not run this until incremental ingest, extraction review, and citations are
trusted. Requires `--confirm-backfill`. Not started by docker-compose.
"""

from __future__ import annotations

import argparse
import logging
from datetime import date

from common.db import connection

from .config import BACKFILL_SLICES, BackfillSlice
from .fetch_documents import drain, enqueue_pending
from .search import search_filings
from .session import session

logger = logging.getLogger(__name__)


def _start_run(slice_name: str) -> str:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sedar.scrape_runs (mode, slice, started_at, docs_found, docs_fetched, challenges_hit)
            VALUES ('backfill', %s, now(), 0, 0, 0)
            RETURNING id;
            """,
            (slice_name,),
        )
        return str(cur.fetchone()["id"])


def _finish_run(run_id: str, found: int, fetched: int, notes: str) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sedar.scrape_runs
               SET finished_at = now(),
                   docs_found = %s,
                   docs_fetched = %s,
                   notes = %s
             WHERE id = %s;
            """,
            (found, fetched, notes, run_id),
        )


def run_slice(slice_cfg: BackfillSlice, *, headful: bool, limit: int) -> dict[str, int]:
    run_id = _start_run(slice_cfg.name)
    found = 0
    enqueued = 0
    try:
        with session(headful=headful) as sess:
            filings = search_filings(
                sess,
                document_type=slice_cfg.document_type_query,
                date_from=date.fromisoformat(slice_cfg.date_from),
                date_to=date.fromisoformat(slice_cfg.date_to),
            )
            found = len(filings)
            for filing in filings[:limit]:
                if enqueue_pending(filing, discovered_via="backfill"):
                    enqueued += 1
        fetched = drain(headful=headful, limit=limit)
        _finish_run(run_id, found, fetched.get("fetched", 0), f"enqueued={enqueued}")
        return {"found": found, "enqueued": enqueued, **fetched}
    except Exception as exc:  # noqa: BLE001
        _finish_run(run_id, found, 0, str(exc)[:2000])
        raise


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="SEDAR+ historical backfill (gated).")
    parser.add_argument("--confirm-backfill", action="store_true", required=True)
    parser.add_argument("--slice", choices=[s.name for s in BACKFILL_SLICES], required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--headful", action="store_true")
    args = parser.parse_args()
    slice_cfg = next(s for s in BACKFILL_SLICES if s.name == args.slice)
    logger.warning("starting gated backfill slice=%s limit=%s", slice_cfg.name, args.limit)
    counts = run_slice(slice_cfg, headful=args.headful, limit=args.limit)
    logger.info("backfill %s", counts)


if __name__ == "__main__":
    main()
