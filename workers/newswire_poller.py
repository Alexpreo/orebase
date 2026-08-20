"""RSS poller for mining press releases (GlobeNewswire, Newsfile, Accesswire).

Triage + embeddings still happen via the normal processor/extractor path.
Numeric extraction is skipped because doc_type is press_release.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import urlparse

import httpx

from common.config import settings
from common.db import document_exists_by_external_id, document_exists_by_sha256, enqueue_job, insert_document
from common.metrics import emit_freshness, put_documents_ingested
from common.s3 import PDF_CONTENT_TYPE, upload_object
from common.render import RENDER_ENGINE, html_to_pdf

logger = logging.getLogger(__name__)

HTML_CONTENT_TYPE = "text/html"
MINING_HINTS = (
    "drill",
    "intercept",
    "ni 43-101",
    "sk-1300",
    "resource",
    "reserve",
    "mine",
    "mining",
    "gold",
    "copper",
    "lithium",
    "uranium",
    "nickel",
)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _feeds() -> list[str]:
    return [part.strip() for part in settings.newswire_feeds.split(",") if part.strip()]


def _text(el: Optional[ET.Element]) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def _parse_rss(xml_bytes: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(xml_bytes)
    items: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        link = _text(item.find("link"))
        title = _text(item.find("title"))
        pub = _text(item.find("pubDate"))
        guid = _text(item.find("guid")) or link
        if not link:
            continue
        items.append({"link": link, "title": title, "pub": pub, "guid": guid})
    return items


def _looks_mining(title: str) -> bool:
    lowered = title.lower()
    return any(hint in lowered for hint in MINING_HINTS)


def _filed_at(pub: str) -> Optional[str]:
    if not pub:
        return None
    try:
        return parsedate_to_datetime(pub).date().isoformat()
    except (TypeError, ValueError, IndexError):
        return None


def ingest_item(client: httpx.Client, item: dict[str, str]) -> str:
    guid = item["guid"]
    if document_exists_by_external_id("newswire", guid):
        return "skipped_dupe"
    try:
        response = client.get(item["link"], timeout=30.0, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("newswire download failed %s: %s", item["link"], exc)
        return "error"
    data = response.content
    sha = _sha256(data)
    if document_exists_by_sha256(sha):
        return "skipped_dupe"
    host = urlparse(item["link"]).netloc.replace("www.", "")
    stamp = datetime.now(timezone.utc).strftime("%Y/%m")
    base_key = f"newswire/{host}/{stamp}/{sha[:16]}"
    content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
    if "pdf" in content_type or item["link"].lower().endswith(".pdf"):
        storage_path = upload_object(data, f"{base_key}.pdf", PDF_CONTENT_TYPE)
        source_path = None
        render_engine = None
        source_type = PDF_CONTENT_TYPE
    else:
        source_path = upload_object(data, f"{base_key}.html", HTML_CONTENT_TYPE)
        try:
            pdf_bytes = html_to_pdf(data, base_url=item["link"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("newswire render failed %s: %s", item["link"], exc)
            return "error"
        storage_path = upload_object(pdf_bytes, f"{base_key}.pdf", PDF_CONTENT_TYPE)
        render_engine = RENDER_ENGINE
        source_type = HTML_CONTENT_TYPE
    document_id = insert_document(
        source="newswire",
        source_url=item["link"],
        external_id=guid,
        doc_type="press_release",
        title=item["title"] or item["link"],
        filed_at=_filed_at(item["pub"]),
        sha256=sha,
        storage_path=storage_path,
        source_storage_path=source_path,
        source_content_type=source_type,
        render_engine=render_engine,
        status="ingested",
    )
    if document_id is None:
        return "skipped_dupe"
    enqueue_job(document_id, job_type="parse")
    return "ingested"


def run(limit: int) -> dict[str, int]:
    counts = {"ingested": 0, "skipped_dupe": 0, "skipped_offtopic": 0, "error": 0, "seen": 0}
    headers = {"User-Agent": settings.edgar_user_agent, "Accept": "application/rss+xml, application/xml, text/xml"}
    with httpx.Client(headers=headers, timeout=30.0, follow_redirects=True) as client:
        for feed in _feeds():
            try:
                payload = client.get(feed)
                payload.raise_for_status()
                items = _parse_rss(payload.content)
            except Exception as exc:  # noqa: BLE001
                logger.warning("feed %s failed: %s", feed, exc)
                continue
            for item in items:
                if counts["ingested"] + counts["skipped_dupe"] + counts["error"] >= limit:
                    break
                counts["seen"] += 1
                if not _looks_mining(item["title"]):
                    counts["skipped_offtopic"] += 1
                    continue
                result = ingest_item(client, item)
                counts[result] = counts.get(result, 0) + 1
    if counts["ingested"]:
        put_documents_ingested("newswire", counts["ingested"])
    emit_freshness("newswire")
    return counts


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Poll mining newswire RSS feeds.")
    parser.add_argument("--limit", type=int, default=25)
    args = parser.parse_args()
    counts = run(args.limit)
    logger.info("newswire %s", counts)
    if settings.debug:
        logger.info("[DEBUG] newswire.feeds=%s seen=%s ingested=%s", len(_feeds()), counts["seen"], counts["ingested"])


if __name__ == "__main__":
    main()
