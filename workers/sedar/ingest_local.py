"""Ingest NI 43-101 PDFs from a SEDAR+ bulk download (nested folders + zip).

SEDAR+ names files like ``Technical report (NI 43-101) - English.pdf (abc123)``.
Finder shows Kind as Document and a double-click looks like garbage; the bytes
are still a PDF. Point this at the unzipped tree (or the zip) and it walks
recursively, keeps English 43-101s, and skips French duplicates.

    uv run python -m sedar.ingest_local --dir ~/Downloads/requested_documents
    uv run python -m sedar.ingest_local --zip ~/Downloads/requested_documents.zip --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import re
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import httpx

from common.config import settings

from .config import map_doc_type
from .fetch_documents import ingest_bytes

logger = logging.getLogger(__name__)

ALLOWED_DOC_TYPES = frozenset(
    {"ni43101", "pea", "pfs", "fs", "press_release", "mda", "financials"}
)
PDF_MAGIC = b"%PDF"
ISSUER_DIR_RE = re.compile(r"^\d+\s+(.*)$")
SKIP_DIR_NAMES = {".ds_store", "__macosx"}


def _issuer_from_path(path: Path, root: Path) -> str:
    try:
        top = path.relative_to(root).parts[0]
    except ValueError:
        top = path.parent.name
    match = ISSUER_DIR_RE.match(top.strip())
    return (match.group(1) if match else top).strip(" .")


def _title_from_path(path: Path, root: Path) -> str:
    issuer = _issuer_from_path(path, root)
    raw = path.name
    raw = re.sub(r"\.pdf\s*\([0-9a-f]+\)$", ".pdf", raw, flags=re.I)
    raw = re.sub(r"\.pdf$", "", raw, flags=re.I)
    return " — ".join(part for part in (issuer, raw.strip()) if part)


def _doc_type_from_path(path: Path, fallback: str) -> str:
    blob = str(path).lower()
    if "43-101" in blob or "technical_report" in blob or "technical report" in blob:
        return "ni43101"
    if "material_change" in blob:
        return "mda"
    if "news" in blob or "press" in blob:
        return "press_release"
    return map_doc_type(blob) if blob else fallback


def _is_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(5).startswith(PDF_MAGIC)
    except OSError:
        return False


def _is_french(path: Path) -> bool:
    return "french" in path.name.lower()


def discover_pdfs(root: Path, *, include_french: bool) -> list[Path]:
    found: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if any(part.lower() in SKIP_DIR_NAMES for part in path.parts):
            continue
        if not _is_pdf(path):
            logger.info("skip not-pdf %s", path)
            continue
        if _is_french(path) and not include_french:
            logger.info("skip french %s", path)
            continue
        found.append(path)
    return found


def _download_pdf(url: str) -> bytes:
    lowered = url.lower()
    if "sedarplus" in lowered or "sedar.ca" in lowered:
        raise ValueError(
            "SEDAR+ links cannot be fetched from this CLI. Download the PDF in "
            "Chrome, then pass --dir or --zip."
        )
    headers = {"User-Agent": settings.edgar_user_agent}
    with httpx.Client(follow_redirects=True, timeout=120.0, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        data = response.content
    if not data.startswith(PDF_MAGIC):
        raise ValueError("URL did not return a PDF")
    return data


def ingest_pdf_bytes(
    *,
    data: bytes,
    title: str,
    filed_at: date | None,
    doc_type: str,
    source_url: str,
    external_id: str,
) -> str:
    sha = hashlib.sha256(data).hexdigest()
    document_id = ingest_bytes(
        data=data,
        filing_url=source_url,
        external_id=external_id or f"manual:{sha}",
        title=title,
        filed_at=filed_at,
        doc_type=doc_type,
    )
    return document_id or "skipped_dupe"


def _ingest_tree(
    root: Path,
    *,
    issuer: str,
    title: str,
    filed: date | None,
    doc_type: str,
    include_french: bool,
    dry_run: bool,
) -> int:
    count = 0
    for path in discover_pdfs(root, include_french=include_french):
        display = title or _title_from_path(path, root)
        if issuer:
            display = f"{issuer} — {display}" if issuer not in display else display
        mapped = doc_type if doc_type != "ni43101" else _doc_type_from_path(path, doc_type)
        size_mb = path.stat().st_size / (1024 * 1024)
        if dry_run:
            logger.info("would ingest %.1fMB %s type=%s", size_mb, display, mapped)
            count += 1
            continue
        result = ingest_pdf_bytes(
            data=path.read_bytes(),
            title=display,
            filed_at=filed,
            doc_type=mapped,
            source_url="manual-upload",
            external_id="",
        )
        logger.info("%.1fMB %s -> %s", size_mb, display, result)
        count += 1
    return count


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Ingest Canadian NI 43-101 PDFs from a SEDAR+ zip or nested folder."
    )
    parser.add_argument("--file", type=Path, help="one PDF")
    parser.add_argument("--dir", type=Path, help="unzipped SEDAR+ tree (walked recursively)")
    parser.add_argument("--zip", type=Path, dest="zip_path", help="requested_documents.zip")
    parser.add_argument("--url", default="", help="https URL of a PDF on an issuer site")
    parser.add_argument("--issuer", default="", help="override company name (omit for a mixed dump)")
    parser.add_argument("--title", default="", help="override title for --file / --url")
    parser.add_argument("--filed-at", default="", help="YYYY-MM-DD")
    parser.add_argument("--doc-type", default="ni43101", choices=sorted(ALLOWED_DOC_TYPES))
    parser.add_argument("--include-french", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="list PDFs, do not upload")
    args = parser.parse_args()
    if not args.file and not args.dir and not args.zip_path and not args.url:
        parser.error("pass --dir, --zip, --file, or --url")
    filed = date.fromisoformat(args.filed_at) if args.filed_at else None

    total = 0
    if args.url:
        data = _download_pdf(args.url)
        display = " — ".join(part for part in (args.issuer, args.title) if part) or args.url
        if args.dry_run:
            logger.info("would ingest url %s", display)
            total += 1
        else:
            result = ingest_pdf_bytes(
                data=data,
                title=display,
                filed_at=filed,
                doc_type=args.doc_type,
                source_url=args.url,
                external_id="",
            )
            logger.info("%s -> %s", display, result)
            total += 1
    if args.file:
        if not _is_pdf(args.file):
            raise SystemExit(f"{args.file} is not a PDF")
        display = " — ".join(
            part for part in (args.issuer, args.title or args.file.name) if part
        )
        if args.dry_run:
            logger.info("would ingest %s", display)
            total += 1
        else:
            result = ingest_pdf_bytes(
                data=args.file.read_bytes(),
                title=display,
                filed_at=filed,
                doc_type=args.doc_type,
                source_url="manual-upload",
                external_id="",
            )
            logger.info("%s -> %s", display, result)
            total += 1
    if args.dir:
        total += _ingest_tree(
            args.dir,
            issuer=args.issuer,
            title=args.title,
            filed=filed,
            doc_type=args.doc_type,
            include_french=args.include_french,
            dry_run=args.dry_run,
        )
    if args.zip_path:
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(args.zip_path) as archive:
                archive.extractall(tmp)
            total += _ingest_tree(
                Path(tmp),
                issuer=args.issuer,
                title=args.title,
                filed=filed,
                doc_type=args.doc_type,
                include_french=args.include_french,
                dry_run=args.dry_run,
            )
    logger.info("ingest considered %s file(s)", total)


if __name__ == "__main__":
    main()
