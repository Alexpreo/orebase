"""Processor: drains raw.processing_jobs and runs the parse -> chunk -> embed pipeline for
one document, advancing raw.documents.status (ingested -> parsed -> indexed).

Job claiming uses SELECT ... FOR UPDATE SKIP LOCKED (see common.db.claim_job) so many
processor instances can run concurrently without stepping on each other. Failures capture
last_error and re-queue with exponential backoff.
"""

from __future__ import annotations

import argparse
import io
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import fitz  # PyMuPDF
import pdfplumber

from common.config import settings
from common.db import (
    claim_job,
    complete_job,
    get_document,
    queue_depth,
    replace_document_chunks,
    set_document_status,
)
from common.embeddings import embed_texts
from common.s3 import download_object

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("processor")

# Chunking budget. Roughly 4 chars/token, so ~800 tokens ~= 3200 chars, ~100 overlap ~= 400.
CHARS_PER_TOKEN = 4
CHUNK_TARGET_TOKENS = 800
CHUNK_OVERLAP_TOKENS = 100
CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN
CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN

# Pages with less extractable text than this are candidates for OCR. Note that this catches
# more than scans: technical reports embed maps, cross-sections, and drill plans as images,
# so ~11% of pages in HTML-rendered reports land here with nothing scanned about them.
LOW_TEXT_CHAR_THRESHOLD = 100

OCR_BACKEND_NONE = "none"
OCR_BACKEND_TEXTRACT = "textract"
OCR_BACKEND_TESSERACT = "tesseract"

# Textract bills $1.50 per 1,000 pages, so a fully scanned 400-page report costs $0.60 and a
# scanned backfill would outspend the entire extraction budget. Cap how many pages one
# document may OCR; beyond the cap, pages are left empty and the document is flagged so full
# OCR can be run deliberately for projects someone actually cares about.
MAX_OCR_PAGES_PER_DOCUMENT = 40

MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 2.0

# Section headings drive the single biggest extraction cost saving: knowing that resources
# live in "Item 14" / "XI. Mineral Resource Estimates" lets the extractor send ~20k tokens
# instead of a whole 200k-token report. Reports number their sections inconsistently, so all
# three real-world conventions are matched:
#   "Item 14 Mineral Resource Estimates"   NI 43-101 and SEC item style
#   "XI. Mineral Resource Estimates"       Roman numerals (common in SK-1300 summaries)
#   "14.1 Mineral Resource Estimate"       plain decimal numbering
# Headings are short lines, so a length ceiling keeps ordinary sentences from matching.
MAX_HEADING_CHARS = 120

_HEADING_PATTERNS = (
    re.compile(r"^\s*(item\s+\d+[a-z]?\b.*)$", re.IGNORECASE),
    re.compile(r"^\s*((?:[IVXLC]+)[.)]\s+[A-Z].*)$"),
    re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2})*[.)]?\s+[A-Z].*)$"),
)


@dataclass
class Block:
    """An atomic unit of page content. Table blocks are never split across chunks."""

    text: str
    is_table: bool = False


@dataclass
class Page:
    number: int  # 1-based
    blocks: list[Block] = field(default_factory=list)
    was_ocr: bool = False
    ocr_skipped: bool = False  # low-text page left unread because the OCR cap was hit


def _textract_page_text(page: "fitz.Page") -> str:
    """OCR a scanned/low-text page via AWS Textract.

    Textract is preferred over Tesseract because it is materially better on the dense
    resource/economics tables common in mining technical reports. The page is rasterized to
    PNG first because Textract's synchronous detect_document_text takes an image or 1-page PDF.
    """
    import boto3

    pix = page.get_pixmap(dpi=200)
    png_bytes = pix.tobytes("png")
    client = boto3.client(
        "textract",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )
    resp = client.detect_document_text(Document={"Bytes": png_bytes})
    lines = [b["Text"] for b in resp.get("Blocks", []) if b.get("BlockType") == "LINE"]
    return "\n".join(lines)


def _tesseract_page_text(page: "fitz.Page") -> str:
    """OCR via the local Tesseract install PyMuPDF links against.

    A local fallback for when Textract is unreachable. Weaker on dense numeric tables, so
    it is a stopgap rather than an equivalent.
    """
    return page.get_textpage_ocr(dpi=200, full=False).extractText()


_OCR_BACKENDS = {
    OCR_BACKEND_TEXTRACT: _textract_page_text,
    OCR_BACKEND_TESSERACT: _tesseract_page_text,
}


def _ocr_page_text(page: "fitz.Page") -> str:
    """Read a low-text page with the configured OCR backend.

    Returns empty string when OCR is disabled or the backend fails. A page that cannot be
    read is a gap in one page's text, not grounds for discarding a whole parsed document:
    a 256-page report with one unreadable figure is still worth indexing.
    """
    backend = _OCR_BACKENDS.get(settings.ocr_backend.strip().lower())
    if backend is None:
        return ""
    try:
        return backend(page)
    except Exception as exc:  # noqa: BLE001 - any OCR failure degrades to an unread page
        logger.warning("OCR failed on page %d via %s: %s", page.number + 1, settings.ocr_backend, exc)
        return ""


def _tables_by_page(data: bytes) -> dict[int, list[str]]:
    """Extract tables per page with pdfplumber, rendered as tab-separated text blocks."""
    tables: dict[int, list[str]] = {}
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for idx, page in enumerate(pdf.pages, start=1):
            rendered: list[str] = []
            for table in page.extract_tables() or []:
                rows = [
                    "\t".join((cell or "").strip() for cell in row)
                    for row in table
                    if any(cell for cell in row)
                ]
                if rows:
                    rendered.append("\n".join(rows))
            if rendered:
                tables[idx] = rendered
    return tables


_TEXT_BLOCK_TYPE = 0


def _layout_blocks(page: "fitz.Page") -> list[Block]:
    """Split a page into layout paragraphs.

    PyMuPDF's plain-text output separates lines with single newlines and never with blank
    lines, so splitting on "\\n\\n" yields one block per page and hides every heading that
    is not at the top of a page. The layout-block extractor returns real paragraphs, which
    is what makes section detection work.
    """
    blocks: list[Block] = []
    for raw in page.get_text("blocks", sort=True):
        text, block_type = raw[4], raw[6]
        if block_type != _TEXT_BLOCK_TYPE:
            continue  # image block
        cleaned = (text or "").strip()
        if cleaned:
            blocks.append(Block(text=cleaned))
    return blocks


def _ocr_blocks(ocr_text: str) -> list[Block]:
    """Textract returns one line per detected LINE; treat each as its own block.

    Chunking reassembles blocks up to the token budget, so finer blocks cost nothing and
    let headings on scanned pages be detected the same way as digital ones.
    """
    return [Block(text=line.strip()) for line in ocr_text.splitlines() if line.strip()]


def parse_pdf(data: bytes, max_ocr_pages: int = MAX_OCR_PAGES_PER_DOCUMENT) -> list[Page]:
    """Return per-page text/table blocks, OCR-ing low-text pages up to a cap.

    Pages that stay unread — because OCR is disabled, capped, or failed — are flagged rather
    than raised on. Every page that did yield text still gets indexed.
    """
    tables = _tables_by_page(data)
    pages: list[Page] = []
    ocr_pages_used = 0
    with fitz.open(stream=data, filetype="pdf") as doc:
        for idx in range(doc.page_count):
            fitz_page = doc.load_page(idx)
            page_no = idx + 1
            text = fitz_page.get_text("text") or ""

            page = Page(number=page_no)
            if len(text.strip()) < LOW_TEXT_CHAR_THRESHOLD:
                ocr_text = ""
                if ocr_pages_used < max_ocr_pages:
                    ocr_text = _ocr_page_text(fitz_page)
                if ocr_text.strip():
                    # Budget counts pages actually read, so disabled or failed OCR does not
                    # consume the cap and starve later pages that could have been read.
                    ocr_pages_used += 1
                    page.was_ocr = True
                    page.blocks.extend(_ocr_blocks(ocr_text))
                else:
                    page.ocr_skipped = True
            else:
                page.blocks.extend(_layout_blocks(fitz_page))

            for table_text in tables.get(page_no, []):
                page.blocks.append(Block(text=table_text, is_table=True))

            pages.append(page)
    return pages


def _detect_section(text: str, current: Optional[str]) -> Optional[str]:
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    if not first_line or len(first_line) > MAX_HEADING_CHARS:
        return current
    for pattern in _HEADING_PATTERNS:
        match = pattern.match(first_line)
        if match:
            return match.group(1).strip()[:200]
    return current


@dataclass
class Chunk:
    chunk_index: int
    page_start: int
    page_end: int
    content: str
    section_title: Optional[str]


def chunk_pages(pages: list[Page]) -> list[Chunk]:
    """Greedy ~800-token chunks with ~100-token overlap; tables stay whole.

    Overlap is only carried across non-table paragraph text so a table is never duplicated
    or cut. page_start/page_end anchor each chunk for citations.
    """
    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_len = 0
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    section: Optional[str] = None
    chunk_index = 0

    def flush() -> None:
        nonlocal buf, buf_len, page_start, page_end, chunk_index
        if not buf:
            return
        content = "\n\n".join(buf).strip()
        if content:
            chunks.append(
                Chunk(
                    chunk_index=chunk_index,
                    page_start=page_start or 1,
                    page_end=page_end or page_start or 1,
                    content=content,
                    section_title=section,
                )
            )
            chunk_index += 1
        # Carry a small overlap tail (paragraph text only) into the next chunk.
        tail = content[-CHUNK_OVERLAP_CHARS:] if content else ""
        buf = [tail] if tail else []
        buf_len = len(tail)

    for page in pages:
        for block in page.blocks:
            section = _detect_section(block.text, section)
            block_len = len(block.text)

            if buf and buf_len + block_len > CHUNK_TARGET_CHARS:
                flush()
                page_start = page.number

            if page_start is None:
                page_start = page.number
            page_end = page.number

            # A single oversized table becomes its own chunk rather than being split.
            if block.is_table and block_len > CHUNK_TARGET_CHARS and buf:
                flush()
                page_start = page.number

            buf.append(block.text)
            buf_len += block_len

    flush()
    return chunks


def process_document(document_id: str) -> dict[str, int]:
    doc = get_document(document_id)
    if doc is None:
        raise RuntimeError(f"document {document_id} not found")
    if not doc.get("storage_path"):
        raise RuntimeError(f"document {document_id} has no storage_path")

    data = download_object(doc["storage_path"])

    pages = parse_pdf(data)
    set_document_status(document_id, "parsed", page_count=len(pages))

    ocr_pages = sum(1 for p in pages if p.was_ocr)
    skipped_ocr_pages = sum(1 for p in pages if p.ocr_skipped)
    if skipped_ocr_pages:
        logger.warning(
            "document %s: %d low-text page(s) left unread with ocr_backend=%s (OCR'd %d)",
            document_id, skipped_ocr_pages, settings.ocr_backend, ocr_pages,
        )

    chunks = chunk_pages(pages)
    embeddings = embed_texts([c.content for c in chunks]) if chunks else []

    chunk_rows = [
        {
            "chunk_index": c.chunk_index,
            "page_start": c.page_start,
            "page_end": c.page_end,
            "content": c.content,
            "section_title": c.section_title,
            "embedding": embeddings[i],
        }
        for i, c in enumerate(chunks)
    ]
    replace_document_chunks(document_id, chunk_rows)
    set_document_status(document_id, "indexed")

    return {
        "page_count": len(pages),
        "chunk_count": len(chunks),
        "ocr_pages": ocr_pages,
        "skipped_ocr_pages": skipped_ocr_pages,
    }


def _handle_job(job: dict[str, Any]) -> None:
    job_id = job["id"]
    document_id = job["document_id"]
    try:
        stats = process_document(document_id)
        complete_job(job_id, status="done")
        if settings.debug:
            logger.info(
                "[DEBUG] processor.job done job=%s doc=%s pages=%d chunks=%d "
                "ocr_pages=%d skipped_ocr=%d queue_depth=%d",
                job_id, document_id, stats["page_count"], stats["chunk_count"],
                stats["ocr_pages"], stats["skipped_ocr_pages"], queue_depth("parse"),
            )
    except Exception as exc:  # noqa: BLE001 - we persist the error and decide retry vs fail
        attempts = int(job.get("attempts", 0))
        set_document_status(document_id, "failed")
        if attempts >= MAX_ATTEMPTS:
            complete_job(job_id, status="failed", last_error=str(exc)[:2000])
            logger.error("job %s permanently failed after %d attempts: %s", job_id, attempts, exc)
        else:
            backoff = BACKOFF_BASE_SECONDS * (2 ** (attempts - 1))
            complete_job(job_id, status="pending", last_error=str(exc)[:2000])
            logger.warning(
                "job %s failed (attempt %d), re-queued; backing off %.1fs: %s",
                job_id, attempts, backoff, exc,
            )
            time.sleep(backoff)


def run(once: bool, idle_sleep: float) -> None:
    logger.info("processor started (once=%s)", once)
    while True:
        job = claim_job("parse")
        if job is None:
            if once:
                break
            time.sleep(idle_sleep)
            continue
        _handle_job(job)
        if once:
            break


def main() -> None:
    parser = argparse.ArgumentParser(description="Drain the OreBase processing job queue.")
    parser.add_argument("--once", action="store_true", help="process a single job then exit")
    parser.add_argument("--idle-sleep", type=float, default=5.0, help="seconds to wait when queue is empty")
    args = parser.parse_args()
    run(once=args.once, idle_sleep=args.idle_sleep)


if __name__ == "__main__":
    main()
