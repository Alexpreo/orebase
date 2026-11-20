"""Link filings that have no company, from identifiers already on the row. No model calls.

EDGAR: CIK from the title or the sec.gov URL, name from the title.
SEDAR: issuer name from the title ("Sanu Gold Corp. — Technical report ...").
Matches an existing company by CIK, then by exact name; creates one only with --create.

    uv run python -m scripts.link_companies            # dry run: prints the plan
    uv run python -m scripts.link_companies --apply    # link to existing companies
    uv run python -m scripts.link_companies --apply --create   # also create missing ones
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from typing import Any, Optional

from common.db import connection, update_document_entities
from common.resolve import parse_title_company, upsert_company

_CIK_URL = re.compile(r"/edgar/data/(\d{1,10})/")
_SEDAR_TITLE = re.compile(r"^(?P<name>.+?)\s+[—-]\s+(Technical report|Amended technical report)", re.IGNORECASE)


def identify(doc: dict[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(name, cik, ticker) for a filing, or Nones when the row carries nothing reliable."""
    title = (doc.get("title") or "").strip()
    if doc["source"] == "edgar":
        name, ticker, cik = parse_title_company(title)
        # "ALBEMARLE CORP  (ALB, ALB-PA)": the shared parser only handles one ticker.
        m = re.match(r"^(.*?)\s*\(([A-Z0-9.,\s-]+)\)\s*$", name or "")
        if m:
            name, ticker = m.group(1).strip(), ticker or m.group(2).split(",")[0].strip()
        if not cik:
            m = _CIK_URL.search(doc.get("source_url") or "")
            cik = m.group(1).zfill(10) if m else None
        return (name, cik, ticker) if cik and name else (None, None, None)
    m = _SEDAR_TITLE.match(title)
    return (m.group("name").strip(), None, None) if m else (None, None, None)


def existing_company(cur: Any, name: str, cik: Optional[str]) -> Optional[str]:
    if cik:
        cur.execute("SELECT id FROM core.companies WHERE cik = %s LIMIT 1", (cik,))
        row = cur.fetchone()
        if row:
            return str(row["id"])
    cur.execute("SELECT id FROM core.companies WHERE lower(name) = lower(%s) LIMIT 2", (name,))
    rows = cur.fetchall()
    return str(rows[0]["id"]) if len(rows) == 1 else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write links (default: dry run)")
    parser.add_argument("--create", action="store_true", help="create companies that do not exist yet")
    args = parser.parse_args()

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, source, source_url, title FROM raw.documents WHERE company_id IS NULL ORDER BY filed_at"
        )
        docs = cur.fetchall()
        plan = []
        for doc in docs:
            name, cik, ticker = identify(doc)
            if not name:
                plan.append((doc, None, None, None, None))
                continue
            plan.append((doc, name, cik, ticker, existing_company(cur, name, cik)))

    counts: Counter[str] = Counter()
    new_names: Counter[str] = Counter()
    for doc, name, cik, ticker, company_id in plan:
        if not name:
            counts["no identifier"] += 1
        elif company_id:
            counts["link to existing company"] += 1
            if args.apply:
                update_document_entities(str(doc["id"]), company_id=company_id)
        else:
            counts["company does not exist yet"] += 1
            new_names[name] += 1
            if args.apply and args.create:
                cid = upsert_company(name=name, cik=cik, ticker=ticker)
                if cid:
                    update_document_entities(str(doc["id"]), company_id=cid)
                    counts["created and linked"] += 1

    print(f"{len(plan)} filings with no company")
    for k, v in counts.most_common():
        print(f"  {v:4d}  {k}")
    if new_names:
        print(f"\n{len(new_names)} companies would be created{'' if args.create else ' (pass --create)'}; first 15:")
        for name, n in new_names.most_common(15):
            print(f"  {n:3d}  {name}")
    if not args.apply:
        print("\nDry run. Nothing written; pass --apply.")


if __name__ == "__main__":
    main()
