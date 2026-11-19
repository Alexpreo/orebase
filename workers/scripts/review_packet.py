"""Print one document's unreviewed rows next to the source pages that hold their figures,
so a reader can approve, correct, or delete each row.

    uv run python -m scripts.review_packet <document_id>
"""

from __future__ import annotations

import json
import re
import sys

from common.db import connection
from scripts.verify_review import TONNE_SCALES, MONEY_SCALES, _is_toc, _positions

MAX_CHARS = 30_000  # keep a packet readable in one sitting

TABLES = {
    "resource": ("core.resource_estimates", "category, domain, tonnes, grade, contained_metal, cutoff, standard, effective_date"),
    "drill": ("core.drill_results", "hole_id, from_m, to_m, interval_m, assays, true_width_noted"),
    "economics": ("core.project_economics", "study_type, effective_date, currency, npv, irr_pct, capex_initial, aisc, mine_life_years, payback_years"),
}


def _anchors(kind: str, r: dict) -> list[tuple]:
    if kind == "resource":
        return [(r["tonnes"], TONNE_SCALES)]
    if kind == "drill":
        return [(r["interval_m"], (1.0,))]
    return [(v, MONEY_SCALES) for v in (r["npv"] or {}).values() if isinstance(v, (int, float))]


def main() -> None:
    document_id = sys.argv[1]
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT title, doc_type, filed_at FROM raw.documents WHERE id = %s", (document_id,))
        doc = cur.fetchone()
        cur.execute(
            "SELECT page_start, page_end, content FROM raw.document_chunks WHERE document_id = %s ORDER BY chunk_index",
            (document_id,),
        )
        chunks = [c for c in cur.fetchall() if not _is_toc(c["content"])]
        rows = []
        for kind, (table, cols) in TABLES.items():
            cur.execute(f"SELECT id, {cols}, extraction_confidence FROM {table} WHERE document_id = %s AND NOT reviewed", (document_id,))
            rows += [{"kind": kind, **r} for r in cur.fetchall()]
    print(f"# {doc['title']} | {doc['doc_type']} | filed {doc['filed_at']} | document {document_id}\n")
    print(f"## {len(rows)} rows to decide")
    for r in rows:
        print(json.dumps({k: v for k, v in r.items()}, default=str))
    # Pages where any row's anchor figure, hole id, or a resource/economics heading appears.
    holes = [r["hole_id"] for r in rows if r["kind"] == "drill" and r.get("hole_id")]
    wanted = []
    for c in chunks:
        text = c["content"].replace("\xa0", " ")
        hit = any(_positions(text, v, s, 2) for r in rows for v, s in _anchors(r["kind"], r) if v is not None)
        hit = hit or any(h in text for h in holes)
        if hit:
            wanted.append((c["page_start"], c["page_end"], text))
    print(f"\n## source pages ({len(wanted)} chunks matched)")
    used = 0
    for p0, p1, text in wanted:
        if used + len(text) > MAX_CHARS:
            print(f"\n[... {len(wanted)} chunks matched; stopped at {MAX_CHARS} chars. Ask for more pages if a row is undecided.]")
            break
        print(f"\n--- pages {p0}-{p1}\n{re.sub(r'[ \t]+', ' ', text)}")
        used += len(text)


if __name__ == "__main__":
    main()
