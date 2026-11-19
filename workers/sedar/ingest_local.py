"""Ingest NI 43-101 PDFs from a SEDAR+ bulk download (nested folders + zip).

SEDAR+ names files like ``Technical report (NI 43-101) - English.pdf (abc123)``.
Finder shows Kind as Document and a double-click looks like garbage; the bytes
are still a PDF. Point this at the unzipped tree (or the zip) and it walks
recursively, keeps English 43-101s, and skips French duplicates.

    uv run python -m sedar.ingest_local --dir ~/Downloads/requested_documents
    uv run python -m sedar.ingest_local --zip ~/Downloads/requested_documents.zip --dry-run
    uv run python -m sedar.ingest_local --inbox ~/SEDAR/inbox --dry-run   # dated from CSVs
    uv run python -m sedar.ingest_local --inbox ~/SEDAR/inbox --fix-undated
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import logging
import re
import tempfile
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import httpx

from common.config import settings
from common.db import connection

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


# --- SEDAR+ inbox: date each zipped PDF from the CSV search exports, never by guess ---

MANIFEST_HEADER = "page,profile_name,profile_number,document"
EXPORT_HEADER = "Profile(s),Document,Submitted date"
# Zip members look like "000052522 Name / Name /06515195 TECHNICAL_REPORT/1/Doc.pdf (hex)".
MEMBER_ROOT_RE = re.compile(r"^(\d{5,})\s+(.*)$")
FILING_DIR_RE = re.compile(r"^(\d{5,})\s+[A-Z_]+$")
HEX_SUFFIX_RE = re.compile(r"\s*\([0-9a-f]{8,}\)$", re.I)
EXPORT_PROFILE_RE = re.compile(r"\((\d{5,})\)\s*$")


@dataclass(frozen=True)
class IndexRow:
    profile_name: str
    profile_number: str  # "" when SEDAR+ left it blank
    document: str
    submitted_date: date
    submitted_time_et: str
    jurisdiction: str
    file_size_kb: int


def _norm(text: str) -> str:
    text = re.sub(r"\(formerly [^)]*\)", "", text, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _pnum(value: str) -> str:
    # Spreadsheets drop leading zeros; compare profile numbers as integers.
    return value.strip().lstrip("0")


def _rows_from_csv(path: Path) -> list[IndexRow]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    for i, line in enumerate(lines):
        if line.startswith(MANIFEST_HEADER):
            return [
                IndexRow(
                    profile_name=r["profile_name"].strip(),
                    profile_number=r["profile_number"].strip(),
                    document=r["document"].strip(),
                    submitted_date=date.fromisoformat(r["submitted_date"].strip()),
                    submitted_time_et=r["submitted_time_et"].strip(),
                    jurisdiction=r["principal_jurisdiction"].strip(),
                    file_size_kb=int(r["file_size_kb"].replace(",", "").strip()),
                )
                for r in csv.DictReader(lines[i:])
                if r.get("document")
            ]
        if line.startswith(EXPORT_HEADER):
            return [row for r in csv.reader(lines[i + 1 :]) if (row := _export_row(r))]
    logger.warning("skip %s: no SEDAR+ search header found", path.name)
    return []


def _export_row(r: list[str]) -> Optional[IndexRow]:
    """Raw SEDAR+ export: 'Name / Name (000052522)', doc, 'Tue Nov 17 15:35:18 EST 2026', jur, '22495 KB'."""
    if len(r) < 5 or not r[1].strip():
        return None
    match = EXPORT_PROFILE_RE.search(r[0])
    name = (r[0][: match.start()] if match else r[0]).split(" / ")[0].strip()
    parts = r[2].split()  # weekday, month, day, time, zone, year
    return IndexRow(
        profile_name=name,
        profile_number=match.group(1) if match else "",
        document=r[1].strip(),
        submitted_date=datetime.strptime(f"{parts[1]} {parts[2]} {parts[5]}", "%b %d %Y").date(),
        submitted_time_et=parts[3],
        jurisdiction=r[3].strip(),
        file_size_kb=int(r[4].split()[0].replace(",", "")),
    )


def load_index(paths: list[Path]) -> list[IndexRow]:
    """Every CSV into one index; the same filing listed in several exports counts once."""
    seen: dict[tuple, IndexRow] = {}
    for path in paths:
        for row in _rows_from_csv(path):
            # Keyed by name, not profile number: one export may omit the number another has.
            key = (_norm(row.profile_name), _norm(row.document), row.submitted_date,
                   row.submitted_time_et, row.file_size_kb)
            if key not in seen or (row.profile_number and not seen[key].profile_number):
                seen[key] = row
    return list(seen.values())


def parse_member(name: str) -> tuple[str, str, str, str]:
    """Zip member path -> (profile_number, folder company name, filing id, document name)."""
    parts = [p.strip() for p in name.split("/") if p.strip()]
    root = MEMBER_ROOT_RE.match(parts[0])
    profile_number, folder = (root.group(1), root.group(2)) if root else ("", parts[0])
    filing_id = next((m.group(1) for p in parts[1:-1] if (m := FILING_DIR_RE.match(p))), "")
    return profile_number, folder, filing_id, HEX_SUFFIX_RE.sub("", parts[-1])


def match_row(
    profile_number: str, company: str, document: str, size_bytes: int, index: list[IndexRow]
) -> Optional[IndexRow]:
    """The one CSV row for this PDF, or None. Size is always checked, not only on ties: a
    lone same-name candidate can be a different filing from a quarter the CSVs don't cover."""
    doc = _norm(document)
    kb = size_bytes / 1024
    candidates = [
        r
        for r in index
        if _norm(r.document) == doc
        and (
            _pnum(r.profile_number) == _pnum(profile_number)
            if r.profile_number and profile_number
            else _norm(r.profile_name) == _norm(company)
        )
        and abs(r.file_size_kb - kb) <= max(2.0, 0.005 * r.file_size_kb)
    ]
    # One filing listed under two names (a renamed issuer) is still one date, not a tie.
    if len({(r.submitted_date, r.submitted_time_et, r.file_size_kb) for r in candidates}) != 1:
        return None
    return next((r for r in candidates if _norm(r.profile_name) == _norm(company)), candidates[0])


def _existing_by_sha(sha: str) -> Optional[dict]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, filed_at, created_at FROM raw.documents WHERE sha256 = %s;", (sha,))
        return cur.fetchone()


def _set_filed_at(document_id: str, filed: date) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.documents SET filed_at = %s WHERE id = %s AND filed_at IS NULL;",
            (filed, document_id),
        )


def _zip_order(path: Path) -> tuple:
    num = re.search(r"\((\d+)\)", path.name)
    return (int(num.group(1)) if num else 0, path.name)


def ingest_inbox(inbox: Path, extra_csvs: list[Path], *, dry_run: bool, include_french: bool) -> list[str]:
    """Ingest every PDF in every zip under `inbox`, dated from every CSV there. Returns unmatched."""
    from .issuers import upsert_issuer

    index = load_index(sorted(inbox.glob("*.csv")) + extra_csvs)
    logger.info("index: %d unique CSV rows", len(index))
    unmatched: list[str] = []
    print(f"{'zip':34} {'pdfs':>5} {'match':>5} {'unmat':>5} {'french':>6} {'in_db':>5}  dates")
    for zip_path in sorted(inbox.glob("*.zip"), key=_zip_order):
        stats: Counter = Counter()
        dates: list[date] = []
        with zipfile.ZipFile(zip_path) as archive:
            for info in archive.infolist():
                base = info.filename.rsplit("/", 1)[-1]
                if info.is_dir() or base.startswith(".") or "__MACOSX" in info.filename:
                    continue
                data = archive.read(info)
                if not data.startswith(PDF_MAGIC):
                    stats["not_pdf"] += 1
                    continue
                stats["pdfs"] += 1
                profile_number, folder, filing_id, document = parse_member(info.filename)
                if "french" in document.lower() and not include_french:
                    stats["french"] += 1
                    continue
                row = match_row(profile_number, folder, document, len(data), index)
                if row:
                    dates.append(row.submitted_date)
                existing = _existing_by_sha(hashlib.sha256(data).hexdigest())
                if existing:
                    stats["in_db"] += 1
                    # A later refiling of identical bytes (another issuer, an amendment) is
                    # not when we first had the file: never date a doc after its ingest.
                    if (row and existing["filed_at"] is None
                            and row.submitted_date <= existing["created_at"].date()):
                        stats["dated_existing"] += 1
                        if not dry_run:
                            _set_filed_at(str(existing["id"]), row.submitted_date)
                    continue
                if row:
                    stats["matched"] += 1
                else:
                    stats["unmatched"] += 1
                    unmatched.append(f"{zip_path.name}: {info.filename}")
                if dry_run:
                    continue
                company = row.profile_name if row else folder
                doc_title = re.sub(r"\.pdf$", "", document, flags=re.I)
                # SEDAR+ splits a large report into several same-named PDFs; only the
                # " (hex)" suffix tells the parts apart, so it must be part of the id.
                part = info.filename.rsplit("/", 1)[-1]
                new_id = ingest_bytes(
                    data=data,
                    filing_url="manual-upload",
                    external_id=f"sedar:{profile_number}:{filing_id}:{part}",
                    title=f"{company} — {doc_title}",
                    filed_at=row.submitted_date if row else None,
                    doc_type=_doc_type_from_path(Path(info.filename), "ni43101"),
                )
                if new_id is None:
                    stats["not_ingested"] += 1
                    unmatched.append(f"{zip_path.name}: NOT INGESTED (duplicate id) {info.filename}")
                if row and row.profile_number:
                    upsert_issuer(
                        profile_number=row.profile_number,
                        name=row.profile_name,
                        jurisdiction=row.jurisdiction or None,
                        industry=None,
                        active=True,
                    )
        span = f"{min(dates)}..{max(dates)}" if dates else "-"
        extra = f" (+{stats['dated_existing']} old undated rows dated)" if stats["dated_existing"] else ""
        if stats["not_ingested"]:
            extra += f" ({stats['not_ingested']} NOT INGESTED)"
        print(
            f"{zip_path.name:34} {stats['pdfs']:5} {stats['matched']:5} {stats['unmatched']:5} "
            f"{stats['french']:6} {stats['in_db']:5}  {span}{extra}",
            flush=True,
        )
    return unmatched


def fix_undated(inbox: Path, extra_csvs: list[Path], *, dry_run: bool) -> tuple[int, list[str]]:
    """Date undated SEDAR docs by company + document + stored file size; unique matches only."""
    from common.s3 import download_object

    index = load_index(sorted(inbox.glob("*.csv")) + extra_csvs)
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, storage_path FROM raw.documents "
            "WHERE source = 'sedar' AND filed_at IS NULL ORDER BY created_at;"
        )
        docs = cur.fetchall()
    fixed, missed = 0, []
    for doc in docs:
        company, _, rest = (doc["title"] or "").partition(" — ")
        size = len(download_object(doc["storage_path"]))
        row = match_row("", company, f"{rest}.pdf", size, index)
        if row is None:
            missed.append(doc["title"])
            continue
        fixed += 1
        logger.info("%s -> %s", doc["title"], row.submitted_date)
        if not dry_run:
            _set_filed_at(str(doc["id"]), row.submitted_date)
    return fixed, missed


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
    parser.add_argument(
        "--inbox", type=Path, help="folder of requested_documents*.zip + SEDAR+ CSV exports; "
        "every PDF is dated from the CSVs (unmatched ones go in undated)",
    )
    parser.add_argument("--csv", type=Path, nargs="*", default=[], help="extra CSV exports for --inbox")
    parser.add_argument(
        "--fix-undated", action="store_true",
        help="with --inbox: date already-ingested undated SEDAR docs from the CSV index",
    )
    args = parser.parse_args()
    if args.inbox:
        if args.fix_undated:
            fixed, missed = fix_undated(args.inbox, args.csv, dry_run=args.dry_run)
            print(f"\ndated {fixed} undated SEDAR docs; {len(missed)} still undated:")
        else:
            missed = ingest_inbox(
                args.inbox, args.csv, dry_run=args.dry_run, include_french=args.include_french
            )
            print(f"\n{len(missed)} unmatched PDFs (ingested undated):")
        for line in missed:
            print(f"  {line}")
        return
    if not args.file and not args.dir and not args.zip_path and not args.url:
        parser.error("pass --dir, --zip, --file, --url or --inbox")
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
