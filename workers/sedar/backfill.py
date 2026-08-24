"""Historical SEDAR+ harvest. Opt-in only.

Do not run this until incremental ingest, extraction review, and citations are
trusted. Requires `--confirm-backfill`. Not started by docker-compose.
"""

from __future__ import annotations

import argparse
import logging
from datetime import date
from typing import Any, Optional

from psycopg.types.json import Jsonb

from common.db import connection
from common.metrics import notify_challenge

from .config import BACKFILL_SLICES, BackfillSlice
from .fetch_documents import drain, enqueue_pending
from .ratelimit import ChallengeDetected, CircuitOpen
from .search import FilingResult, search_filings
from .session import session

logger = logging.getLogger(__name__)


def _start_run(slice_name: str, checkpoint: Optional[dict[str, Any]] = None) -> str:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sedar.scrape_runs (
                mode, slice, started_at, docs_found, docs_fetched, challenges_hit, checkpoint
            )
            VALUES ('backfill', %s, now(), 0, 0, 0, %s)
            RETURNING id;
            """,
            (slice_name, Jsonb(checkpoint or {})),
        )
        return str(cur.fetchone()["id"])


def _latest_checkpoint(slice_name: str) -> Optional[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT checkpoint
              FROM sedar.scrape_runs
             WHERE mode = 'backfill' AND slice = %s AND checkpoint IS NOT NULL
             ORDER BY started_at DESC
             LIMIT 1;
            """,
            (slice_name,),
        )
        row = cur.fetchone()
        if not row or not row["checkpoint"]:
            return None
        data = row["checkpoint"]
        return data if isinstance(data, dict) else None


def _save_checkpoint(run_id: str, checkpoint: dict[str, Any], *, challenges: int = 0) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sedar.scrape_runs
               SET checkpoint = %s,
                   challenges_hit = challenges_hit + %s
             WHERE id = %s;
            """,
            (Jsonb(checkpoint), challenges, run_id),
        )


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


def _mining_profiles() -> set[str]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT profile_number
              FROM sedar.sedar_issuers
             WHERE active AND profile_number IS NOT NULL;
            """
        )
        return {str(row["profile_number"]) for row in cur.fetchall() if row["profile_number"]}


def run_slice(slice_cfg: BackfillSlice, *, headful: bool, limit: int) -> dict[str, int]:
    prior = _latest_checkpoint(slice_cfg.name) or {}
    start_offset = int(prior.get("offset") or 0)
    run_id = _start_run(slice_cfg.name, {"offset": start_offset})
    found = 0
    enqueued = 0
    mining = _mining_profiles()
    try:
        with session(headful=headful) as sess:
            def on_page(offset: int, rows: list[FilingResult]) -> None:
                _save_checkpoint(
                    run_id,
                    {
                        "offset": offset,
                        "last_external_id": rows[-1].external_id if rows else None,
                    },
                )

            filings = search_filings(
                sess,
                document_type=slice_cfg.document_type_query,
                date_from=date.fromisoformat(slice_cfg.date_from),
                date_to=date.fromisoformat(slice_cfg.date_to),
                paginate=True,
                start_offset=start_offset,
                on_page=on_page,
            )
            if mining:
                filings = [
                    row
                    for row in filings
                    if not row.profile_number or row.profile_number in mining
                ]
            found = len(filings)
            for filing in filings[:limit]:
                if enqueue_pending(filing, discovered_via="backfill"):
                    enqueued += 1
        fetched = drain(headful=headful, limit=limit)
        _finish_run(run_id, found, fetched.get("fetched", 0), f"enqueued={enqueued}")
        return {"found": found, "enqueued": enqueued, **fetched}
    except (ChallengeDetected, CircuitOpen) as exc:
        notify_challenge(str(exc))
        _save_checkpoint(run_id, {"offset": start_offset}, challenges=1)
        _finish_run(run_id, found, 0, str(exc)[:2000])
        raise
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
