"""Inbound SEDAR+ alert email → sedar.pending_fetches.

Deployable as a small FastAPI service (Lambda or a sidecar). The Next.js route
`/api/ingest/sedar-alert` is the Vercel equivalent.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from datetime import date
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from common.config import settings
from common.db import connection

from .config import map_doc_type

logger = logging.getLogger(__name__)

app = FastAPI(title="OreBase SEDAR+ alerts")

_URL = re.compile(r"https?://[^\s<>\"]+")


class AlertPayload(BaseModel):
    subject: str = ""
    text: str = ""
    html: str = ""
    from_email: Optional[str] = Field(default=None, alias="from")
    discovered_via: str = "email_alert"


def _authorized(secret: Optional[str]) -> bool:
    expected = settings.sedar_alert_webhook_secret
    if not expected:
        return True
    if not secret:
        return False
    return hmac.compare_digest(secret, expected)


def _extract_url(payload: AlertPayload) -> Optional[str]:
    blob = f"{payload.subject}\n{payload.text}\n{payload.html}"
    for match in _URL.finditer(blob):
        url = match.group(0).rstrip(").,")
        if "sedarplus" in url.lower() or "sedar" in url.lower():
            return url
    match = _URL.search(blob)
    return match.group(0).rstrip(").,") if match else None


def insert_pending(
    *,
    url: str,
    subject: str,
    discovered_via: str = "email_alert",
) -> Optional[str]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM sedar.pending_fetches
             WHERE external_ref = %s
             LIMIT 1;
            """,
            (url,),
        )
        if cur.fetchone():
            return None
        cur.execute(
            """
            INSERT INTO sedar.pending_fetches (
                source, document_type, filed_date, external_ref, discovered_via, status
            ) VALUES ('sedar', %s, %s, %s, %s, 'pending')
            RETURNING id;
            """,
            (subject[:300] or map_doc_type(subject), date.today(), url, discovered_via),
        )
        row = cur.fetchone()
        return str(row["id"]) if row else None


@app.post("/hooks/sedar-alert")
def sedar_alert(
    payload: AlertPayload,
    x_orebase_secret: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    if not _authorized(x_orebase_secret):
        raise HTTPException(status_code=401, detail="unauthorized")
    url = _extract_url(payload)
    if not url:
        raise HTTPException(status_code=400, detail="no filing URL in payload")
    fetch_id = insert_pending(url=url, subject=payload.subject, discovered_via=payload.discovered_via)
    return {"ok": True, "pending_id": fetch_id, "duplicate": fetch_id is None}


def verify_signature(body: bytes, header: str, secret: str) -> bool:
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, header)
