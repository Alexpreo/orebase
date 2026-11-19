"""Apply review decisions written by a reader (JSON lines), marking rows 'claude_read'.

Each line: {"kind": "resource"|"drill"|"economics", "id": "...", "action": "approve"|"edit"|"delete",
            "fields": {...edits...}, "note": "what the source says"}

    uv run python -m scripts.apply_review decisions.jsonl [--apply]

Edits are limited to the same fields the admin review page can edit. Deletions are printed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from psycopg.types.json import Jsonb

from common.db import connection

TABLES = {"resource": "core.resource_estimates", "drill": "core.drill_results", "economics": "core.project_economics"}
EDITABLE = {  # mirrors apps/web/src/app/api/admin/review/route.ts
    "resource": {"category", "domain", "tonnes", "grade", "contained_metal", "cutoff", "standard", "effective_date", "extraction_confidence"},
    "economics": {"study_type", "effective_date", "currency", "npv", "irr_pct", "capex_initial", "aisc", "mine_life_years", "payback_years", "metal_price_assumptions", "extraction_confidence"},
    "drill": {"hole_id", "announced_date", "from_m", "to_m", "interval_m", "assays", "true_width_noted", "extraction_confidence"},
}
JSON_FIELDS = {"grade", "contained_metal", "npv", "metal_price_assumptions", "assays", "aisc"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("decisions", type=Path, nargs="+")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    counts = {"approve": 0, "edit": 0, "delete": 0, "skipped": 0}
    deleted = []
    with connection() as conn, conn.cursor() as cur:
        for path in args.decisions:
            for n, line in enumerate(path.read_text().splitlines(), 1):
                if not line.strip():
                    continue
                d = json.loads(line)
                table = TABLES[d["kind"]]
                note = (d.get("note") or "")[:500]
                cur.execute(f"SELECT 1 FROM {table} WHERE id = %s AND NOT reviewed", (d["id"],))
                if cur.fetchone() is None:
                    counts["skipped"] += 1  # already reviewed or gone
                    continue
                action = d["action"]
                if action == "delete":
                    deleted.append(f"{d['kind']} {d['id']}: {note}")
                    if args.apply:
                        cur.execute(f"DELETE FROM {table} WHERE id = %s", (d["id"],))
                elif action in ("approve", "edit"):
                    fields = d.get("fields") or {}
                    bad = set(fields) - EDITABLE[d["kind"]]
                    if bad:
                        raise SystemExit(f"{path}:{n}: not editable: {sorted(bad)}")
                    sets = [f"{k} = %s" for k in fields] + ["reviewed = true", "review_source = 'claude_read'", "review_note = %s"]
                    vals = [Jsonb(v) if k in JSON_FIELDS else v for k, v in fields.items()] + [note]
                    if args.apply:
                        cur.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id = %s", (*vals, d["id"]))
                    action = "edit" if fields else "approve"
                else:
                    raise SystemExit(f"{path}:{n}: unknown action {action!r}")
                counts[action] += 1
        if not args.apply:
            conn.rollback()
    print(counts)
    for line in deleted:
        print("  DELETE", line)
    if not args.apply:
        print("dry run: nothing changed (pass --apply)")


if __name__ == "__main__":
    main()
