"""Publish DocumentsLast24h for each active source. Exit 1 if any source is silent.

Intended as an hourly cron on the EC2 box. Compose runs it in the healthcheck service.
"""

from __future__ import annotations

import argparse
import logging
import sys

from common.metrics import emit_freshness

logger = logging.getLogger(__name__)

SOURCES = ("edgar", "sedar", "newswire")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Emit ingestion freshness metrics.")
    parser.add_argument("--fail-if-silent", action="store_true")
    args = parser.parse_args()
    silent: list[str] = []
    for source in SOURCES:
        count = emit_freshness(source)
        logger.info("source=%s documents_last_24h=%s", source, count)
        if count == 0:
            silent.append(source)
    if args.fail_if_silent and silent:
        logger.error("silent sources: %s", ",".join(silent))
        sys.exit(1)


if __name__ == "__main__":
    main()
