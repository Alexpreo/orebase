"""Incremental SEDAR+ loop: drain pending_fetches, optionally run the nightly sweep."""

from __future__ import annotations

import argparse
import logging
from datetime import date, timedelta

from common.metrics import emit_freshness

from .fetch_documents import drain
from .nightly import run_nightly

logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="SEDAR+ incremental ingest (no historical slices).")
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--nightly", action="store_true", help="also search yesterday before draining")
    args = parser.parse_args()
    if args.nightly:
        night = run_nightly(headful=args.headful, day=date.today() - timedelta(days=1))
        logger.info("nightly %s", night)
    counts = drain(headful=args.headful, limit=args.limit)
    freshness = emit_freshness("sedar")
    logger.info("incremental drain=%s freshness_24h=%s", counts, freshness)


if __name__ == "__main__":
    main()
