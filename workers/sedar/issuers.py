"""SEDAR+ Reporting Issuers List → sedar.sedar_issuers."""

from __future__ import annotations

import argparse
import csv
import io
import logging
from pathlib import Path
from typing import Optional

from common.config import settings
from common.db import connection

from .config import DEFAULT_SEARCH_URL, MINING_KEYWORDS
from .session import SedarSession, session

logger = logging.getLogger(__name__)

MINING_INDUSTRY_NEEDLES = ("mining", "mineral", "metals", "gold", "exploration")


def _is_mining(name: str, industry: Optional[str], watchlist: set[str]) -> bool:
    hay = f"{name} {industry or ''}".lower()
    if any(token in hay for token in MINING_KEYWORDS):
        return True
    if industry and any(token in industry.lower() for token in MINING_INDUSTRY_NEEDLES):
        return True
    normalized = name.lower().strip()
    return normalized in watchlist


def _load_watchlist(path: Optional[Path]) -> set[str]:
    if path is None or not path.exists():
        return set()
    names: set[str] = set()
    text = path.read_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames:
        for row in reader:
            for key in ("name", "issuer", "company", "ticker"):
                value = (row.get(key) or "").strip()
                if value:
                    names.add(value.lower())
        return names
    for line in text.splitlines():
        token = line.strip().lower()
        if token and not token.startswith("#"):
            names.add(token)
    return names


def upsert_issuer(
    *,
    profile_number: str,
    name: str,
    jurisdiction: Optional[str],
    industry: Optional[str],
    active: bool,
) -> str:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sedar.sedar_issuers (profile_number, name, jurisdiction, industry, active, last_synced_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (profile_number) DO UPDATE
               SET name = EXCLUDED.name,
                   jurisdiction = COALESCE(EXCLUDED.jurisdiction, sedar.sedar_issuers.jurisdiction),
                   industry = COALESCE(EXCLUDED.industry, sedar.sedar_issuers.industry),
                   active = EXCLUDED.active,
                   last_synced_at = now()
            RETURNING id;
            """,
            (profile_number, name, jurisdiction, industry, active),
        )
        row = cur.fetchone()
        return str(row["id"])


def link_mining_issuers() -> int:
    """Fuzzy-link unique name matches into core.companies. Ambiguous names stay unlinked."""
    linked = 0
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.id, i.name, i.profile_number
              FROM sedar.sedar_issuers i
             WHERE i.active
               AND i.company_id IS NULL;
            """
        )
        issuers = list(cur.fetchall())
        for issuer in issuers:
            cur.execute(
                """
                SELECT id FROM core.companies
                 WHERE lower(name) = lower(%s)
                 LIMIT 2;
                """,
                (issuer["name"],),
            )
            matches = cur.fetchall()
            if len(matches) != 1:
                continue
            company_id = matches[0]["id"]
            cur.execute(
                "UPDATE sedar.sedar_issuers SET company_id = %s WHERE id = %s;",
                (company_id, issuer["id"]),
            )
            cur.execute(
                """
                UPDATE core.companies
                   SET sedar_profile = COALESCE(sedar_profile, %s)
                 WHERE id = %s;
                """,
                (issuer.get("profile_number"), company_id),
            )
            linked += 1
    return linked


def ambiguous_issuer_report() -> list[dict[str, str]]:
    """Issuers that match zero or multiple core.companies by exact name."""
    rows: list[dict[str, str]] = []
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.profile_number, i.name,
                   (SELECT count(*) FROM core.companies c WHERE lower(c.name) = lower(i.name)) AS matches
              FROM sedar.sedar_issuers i
             WHERE i.active AND i.company_id IS NULL
             ORDER BY i.name;
            """
        )
        for row in cur.fetchall():
            matches = int(row["matches"] or 0)
            if matches == 1:
                continue
            rows.append(
                {
                    "profile_number": row["profile_number"] or "",
                    "name": row["name"] or "",
                    "matches": str(matches),
                    "reason": "none" if matches == 0 else "ambiguous",
                }
            )
    return rows


def ingest_rows(rows: list[dict[str, str]], watchlist: set[str], mark_mining: bool) -> dict[str, int]:
    counts = {"upserted": 0, "mining": 0, "skipped": 0}
    for row in rows:
        number = (row.get("profile_number") or row.get("profile") or row.get("number") or "").strip()
        name = (row.get("name") or row.get("issuer") or row.get("legal_name") or "").strip()
        if not number or not name:
            counts["skipped"] += 1
            continue
        industry = (row.get("industry") or row.get("sector") or "").strip() or None
        jurisdiction = (row.get("jurisdiction") or row.get("province") or "").strip() or None
        active = _is_mining(name, industry, watchlist) if mark_mining else True
        if mark_mining and active:
            counts["mining"] += 1
        upsert_issuer(
            profile_number=number,
            name=name,
            jurisdiction=jurisdiction,
            industry=industry,
            active=active if mark_mining else True,
        )
        counts["upserted"] += 1
    return counts


def parse_csv_bytes(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    normalized = []
    for row in reader:
        normalized.append({(k or "").strip().lower().replace(" ", "_"): (v or "").strip() for k, v in row.items()})
    return normalized


def download_via_browser(sess: SedarSession) -> Optional[bytes]:
    """Best-effort: open search, look for an issuers export link. Discovery may replace this."""
    page = sess.goto(settings.sedar_search_url or DEFAULT_SEARCH_URL)
    for name in ("Export", "Download", "Reporting Issuers", "CSV"):
        loc = page.get_by_role("link", name=name, exact=False)
        if loc.count():
            try:
                with page.expect_download(timeout=15_000) as download_info:
                    loc.first.click()
                path = download_info.value.path()
                return Path(path).read_bytes()
            except Exception as exc:  # noqa: BLE001
                logger.warning("issuer export click failed (%s)", exc)
    logger.warning("no issuer export control found; pass --csv")
    return None


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Load SEDAR+ reporting issuers.")
    parser.add_argument("--csv", type=Path, help="Local Reporting Issuers List export")
    parser.add_argument("--watchlist", type=Path, help="CSV of names/tickers to force-mark mining")
    parser.add_argument("--mark-mining", action="store_true", help="set active only on mining-like issuers")
    parser.add_argument("--report", type=Path, help="Write unmatched/ambiguous issuer CSV here")
    parser.add_argument("--headful", action="store_true")
    args = parser.parse_args()
    watchlist = _load_watchlist(args.watchlist)
    if args.csv:
        rows = parse_csv_bytes(args.csv.read_bytes())
    else:
        with session(headful=args.headful) as sess:
            data = download_via_browser(sess)
        if not data:
            raise SystemExit("No issuer list downloaded. Pass --csv after exporting the list by hand.")
        rows = parse_csv_bytes(data)
    counts = ingest_rows(rows, watchlist, args.mark_mining)
    linked = link_mining_issuers()
    ambiguous = ambiguous_issuer_report()
    if args.report:
        with args.report.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["profile_number", "name", "matches", "reason"])
            writer.writeheader()
            writer.writerows(ambiguous)
    logger.info(
        "issuers upserted=%s mining=%s skipped=%s linked=%s unmatched_or_ambiguous=%s",
        counts["upserted"], counts["mining"], counts["skipped"], linked, len(ambiguous),
    )


if __name__ == "__main__":
    main()
