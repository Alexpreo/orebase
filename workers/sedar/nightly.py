"""Nightly SEDAR+ sweep: yesterday's target document types → pending_fetches."""

from __future__ import annotations

import argparse
import logging
from datetime import date, timedelta

from .fetch_documents import enqueue_pending
from .search import search_filings
from .session import session

logger = logging.getLogger(__name__)

TARGET_TYPES = ("NI 43-101", "Material change", "News release")


def run_nightly(*, headful: bool, day: date) -> dict[str, int]:
    counts = {"found": 0, "enqueued": 0, "skipped": 0}
    with session(headful=headful) as sess:
        for document_type in TARGET_TYPES:
            filings = search_filings(
                sess,
                document_type=document_type,
                date_from=day,
                date_to=day,
            )
            counts["found"] += len(filings)
            for filing in filings:
                pending_id = enqueue_pending(filing, discovered_via="nightly_search")
                if pending_id:
                    counts["enqueued"] += 1
                else:
                    counts["skipped"] += 1
    return counts


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Enqueue yesterday's SEDAR+ technical reports.")
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--date", help="YYYY-MM-DD (default: yesterday)")
    args = parser.parse_args()
    day = date.fromisoformat(args.date) if args.date else date.today() - timedelta(days=1)
    counts = run_nightly(headful=args.headful, day=day)
    logger.info("sedar nightly %s day=%s", counts, day.isoformat())


if __name__ == "__main__":
    main()
