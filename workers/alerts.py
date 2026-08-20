"""Email watchlist alerts for new core.project_events.

Users with app.alerts.channel = 'email' receive one Resend message per unmatched
event. Delivery is idempotent via app.alert_deliveries.
"""

from __future__ import annotations

import argparse
import logging
from typing import Any

import httpx

from common.config import settings
from common.db import connection

logger = logging.getLogger(__name__)


def _pending_rows() -> list[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id AS alert_id,
                   a.user_id,
                   u.email,
                   e.id AS event_id,
                   e.event_type,
                   e.event_date,
                   e.summary,
                   e.document_id,
                   p.name AS project_name,
                   c.name AS company_name
              FROM app.alerts a
              JOIN app.users u ON u.id = a.user_id
              JOIN app.watchlists w ON w.user_id = a.user_id
              JOIN app.watchlist_items i ON i.watchlist_id = w.id
              JOIN core.project_events e ON (
                    (i.project_id IS NOT NULL AND e.project_id = i.project_id)
                 OR (i.company_id IS NOT NULL AND e.project_id IN (
                        SELECT p2.id FROM core.projects p2 WHERE p2.company_id = i.company_id
                    ))
              )
              JOIN core.projects p ON p.id = e.project_id
              LEFT JOIN core.companies c ON c.id = p.company_id
             WHERE a.channel = 'email'
               AND u.email IS NOT NULL
               AND u.email <> ''
               AND NOT EXISTS (
                    SELECT 1 FROM app.alert_deliveries d
                     WHERE d.alert_id = a.id
                       AND d.event_id = e.id
                       AND d.channel = 'email'
               )
             ORDER BY e.event_date DESC NULLS LAST
             LIMIT 50;
            """
        )
        return list(cur.fetchall())


def _record_delivery(alert_id: str, event_id: str) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.alert_deliveries (alert_id, event_id, channel)
            VALUES (%s, %s, 'email')
            ON CONFLICT (alert_id, event_id, channel) DO NOTHING;
            """,
            (alert_id, event_id),
        )


def _send(to_email: str, row: dict[str, Any]) -> None:
    if not settings.resend_api_key or not settings.alert_from_email:
        raise RuntimeError("RESEND_API_KEY and ALERT_FROM_EMAIL are required to send email")
    project = row.get("project_name") or "a watched project"
    company = row.get("company_name") or ""
    subject = f"OreBase: {row.get('event_type') or 'update'} — {project}"
    body = (
        f"{company} / {project}\n"
        f"Event: {row.get('event_type')}\n"
        f"Date: {row.get('event_date')}\n\n"
        f"{row.get('summary') or ''}\n"
    )
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": settings.alert_from_email,
            "to": [to_email],
            "subject": subject,
            "text": body,
        },
        timeout=20.0,
    )
    response.raise_for_status()


def run() -> dict[str, int]:
    rows = _pending_rows()
    sent = 0
    errors = 0
    skipped = 0
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY unset; %d pending email alerts not sent", len(rows))
        return {"pending": len(rows), "sent": 0, "errors": 0, "skipped": len(rows)}
    for row in rows:
        try:
            _send(str(row["email"]), row)
            _record_delivery(str(row["alert_id"]), str(row["event_id"]))
            sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("alert send failed: %s", exc)
            errors += 1
    if settings.debug:
        logger.info("[DEBUG] alerts.pending=%s sent=%s errors=%s skipped=%s", len(rows), sent, errors, skipped)
    return {"pending": len(rows), "sent": sent, "errors": errors, "skipped": skipped}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Send watchlist email alerts.")
    parser.add_argument("--once", action="store_true", help="accepted for compose compatibility")
    parser.parse_args()
    logger.info("alerts %s", run())


if __name__ == "__main__":
    main()
