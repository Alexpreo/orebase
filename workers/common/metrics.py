"""CloudWatch custom metrics for silent-death detection.

Disabled unless CLOUDWATCH_METRICS=1. The EC2 compose enables it; local runs do not
spam PutMetricData. Failures here must never fail an ingest.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from .config import settings
from .db import connection

logger = logging.getLogger(__name__)


def put_documents_ingested(source: str, count: int) -> None:
    if not settings.cloudwatch_metrics or count <= 0:
        return
    try:
        import boto3

        boto3.client("cloudwatch", region_name=settings.aws_region).put_metric_data(
            Namespace=settings.cloudwatch_namespace,
            MetricData=[
                {
                    "MetricName": "DocumentsIngested",
                    "Dimensions": [{"Name": "Source", "Value": source}],
                    "Timestamp": datetime.now(timezone.utc),
                    "Value": float(count),
                    "Unit": "Count",
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001 - metrics must not fail ingest
        logger.warning("cloudwatch put failed: %s", exc)


def documents_in_last_hours(source: str, hours: int = 24) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*)::int AS n
              FROM raw.documents
             WHERE source = %s
               AND created_at >= now() - (%s * interval '1 hour');
            """,
            (source, hours),
        )
        row = cur.fetchone()
        return int(row["n"]) if row else 0


def notify_challenge(message: str) -> None:
    """Page operators when Radware stops a SEDAR run. No-op without SNS ARN."""
    arn = settings.sedar_challenge_sns_arn
    logger.error("SEDAR challenge: %s", message)
    if not arn:
        return
    try:
        import boto3

        boto3.client("sns", region_name=settings.aws_region).publish(
            TopicArn=arn,
            Subject="OreBase SEDAR+ challenge — headful solve needed",
            Message=message[:4000],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("challenge SNS publish failed: %s", exc)


def emit_freshness(source: str) -> int:
    """Publish DocumentsLast24h for CloudWatch alarms. Returns the count."""
    count = documents_in_last_hours(source, 24)
    if not settings.cloudwatch_metrics:
        return count
    try:
        import boto3

        boto3.client("cloudwatch", region_name=settings.aws_region).put_metric_data(
            Namespace=settings.cloudwatch_namespace,
            MetricData=[
                {
                    "MetricName": "DocumentsLast24h",
                    "Dimensions": [{"Name": "Source", "Value": source}],
                    "Timestamp": datetime.now(timezone.utc),
                    "Value": float(count),
                    "Unit": "Count",
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("cloudwatch freshness put failed: %s", exc)
    return count
