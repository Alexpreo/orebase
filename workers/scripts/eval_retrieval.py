"""Retrieval quality check: real questions with a known source page, scored through the same
hybrid (vector + full-text, RRF) query the chat uses (apps/web/src/lib/retrieval.ts).

Run before and after any storage change to embeddings or chunks:

    uv run python -m scripts.eval_retrieval --cache /tmp/q.json [--label before]

The expected page is wherever the answer's distinctive figure or ID appears in that document,
so the check survives re-chunking. Query embeddings are cached so runs compare like for like.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from common.db import connection
from common.embeddings import embed_texts

TOP_K = 8          # DEFAULT_TOP_K in retrieval.ts
CANDIDATES = 40    # CANDIDATE_LIMIT
RRF_K = 60

# (question, document id prefix, regex for the answer on the source page)
QUESTIONS = [
    ("What is the after-tax NPV at 8% for NioCorp's Elk Creek project?", "89943466", r"3,441"),
    ("Who are the Dahrouge qualified persons on the NioCorp Elk Creek technical report?", "89943466", r"Trevor Mills"),
    ("What is the after-tax IRR of Salazar Resources' Curipamba El Domo feasibility study?", "8757b6be", r"\b45(\.0)?\s*%"),
    ("What is the initial capital cost in New Pacific Metals' Carangas PEA?", "12dfe123", r"644\.5"),
    ("Which Ausenco engineers are qualified persons for the Carangas PEA?", "12dfe123", r"Kevin Murray"),
    ("What is the IRR of Freeman Gold's Lemhi gold project?", "3b16d27b", r"34\.4"),
    ("What is the after-tax NPV at 7% of 5E Advanced Materials' Fort Cady boron project?", "77ea7742", r"711\.3|711"),
    ("What is the after-tax NPV of the Sio Silica Vivian sand project at 8%?", "0ba75d4f", r"3,043"),
    ("How many indicated gold ounces are in McEwen Mining's resource?", "1f4626ab", r"1,168"),
    ("What is the indicated lithium resource tonnage for Elevra Lithium?", "25754746", r"74\.4"),
    ("What are the indicated tonnes and copper equivalent grade at NexMetals' Selebi project?", "3eddd617", r"78\.2"),
    ("How many inferred gold ounces does Wesdome report?", "4eb8ad78", r"707"),
    ("What is the measured and indicated gold resource at Livengood (International Tower Hill)?", "54fcccce", r"13[.,]6"),
    ("What is the measured and indicated resource for Idaho Strategic Resources?", "87cd584b", r"142,902"),
    ("What graphite grade did Atlas Critical Minerals hole MPDDH-0012 intersect?", "07c1d295", r"MPDDH-0012"),
    ("What copper intercept did Harmony report in hole QNDD009?", "0808afa7", r"QNDD009"),
    ("How many measured and indicated gold ounces does Gold Fields report at 2.1 g/t?", "28515b3a", r"2,926|44,056"),
    ("What did GoldMining's hole SJD-120-24 intersect at São Jorge?", "1e571e7a", r"SJD-120-24"),
    ("What did Intrepid Metals' hole CC25_041 intersect?", "26d44319", r"CC25_041"),
    ("What is Southern Copper's inferred copper resource of about 1.4 billion tonnes?", "2e408615", r"1,433"),
]

SQL = """
WITH params AS (SELECT %(vec)s::{vtype} AS q, plainto_tsquery('english', %(text)s) AS qt),
fc AS (
  SELECT c.id, c.document_id, c.page_start, c.page_end, c.embedding, c.content
  FROM raw.document_chunks c JOIN raw.documents d ON d.id = c.document_id
),
v AS (
  SELECT id, document_id, page_start, page_end,
         row_number() OVER (ORDER BY embedding <=> (SELECT q FROM params)) AS rank
  FROM fc WHERE embedding IS NOT NULL
  ORDER BY embedding <=> (SELECT q FROM params) LIMIT {cand}
),
t AS (
  SELECT id, document_id, page_start, page_end,
         row_number() OVER (ORDER BY ts_rank(to_tsvector('english', content), (SELECT qt FROM params)) DESC) AS rank
  FROM fc WHERE to_tsvector('english', content) @@ (SELECT qt FROM params)
  ORDER BY ts_rank(to_tsvector('english', content), (SELECT qt FROM params)) DESC LIMIT {cand}
)
SELECT COALESCE(v.document_id, t.document_id)::text AS document_id,
       COALESCE(v.page_start, t.page_start) AS page_start,
       COALESCE(v.page_end, t.page_end) AS page_end
FROM v FULL OUTER JOIN t ON v.id = t.id
ORDER BY COALESCE(1.0 / ({rrf} + v.rank), 0) + COALESCE(1.0 / ({rrf} + t.rank), 0) DESC
LIMIT {k}
"""


def _vector_type(cur) -> str:
    cur.execute(
        "SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute "
        "WHERE attrelid = 'raw.document_chunks'::regclass AND attname = 'embedding'"
    )
    return cur.fetchone()["t"]


def _expected_pages(cur, doc_prefix: str, needle: str) -> tuple[str, set[int]]:
    cur.execute(
        "SELECT c.document_id::text AS doc, c.page_start, c.page_end, c.content FROM raw.document_chunks c "
        "WHERE c.document_id::text LIKE %s",
        (doc_prefix + "%",),
    )
    rows = cur.fetchall()
    pattern = re.compile(needle, re.I)
    pages = {
        p
        for r in rows
        if pattern.search(r["content"])
        for p in range(r["page_start"] or 0, (r["page_end"] or r["page_start"] or 0) + 1)
    }
    return (rows[0]["doc"] if rows else ""), pages


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True, help="query-embedding cache (JSON)")
    parser.add_argument("--label", default="run")
    args = parser.parse_args()

    cache = json.loads(args.cache.read_text()) if args.cache.exists() else {}
    missing = [q for q, _, _ in QUESTIONS if q not in cache]
    if missing:
        cache.update(zip(missing, embed_texts(missing, input_type="query")))
        args.cache.write_text(json.dumps(cache))

    hits1 = hits3 = hits8 = 0
    rr = 0.0
    with connection() as conn, conn.cursor() as cur:
        vtype = _vector_type(cur)
        sql = SQL.format(vtype=vtype, cand=CANDIDATES, rrf=RRF_K, k=TOP_K)
        for question, prefix, needle in QUESTIONS:
            doc, pages = _expected_pages(cur, prefix, needle)
            assert pages, f"no source page found for {question!r} ({prefix}, {needle})"
            vec = "[" + ",".join(repr(float(x)) for x in cache[question]) + "]"
            cur.execute(sql, {"vec": vec, "text": question})
            ranks = [
                i
                for i, r in enumerate(cur.fetchall(), 1)
                if r["document_id"] == doc
                and pages & set(range(r["page_start"] or 0, (r["page_end"] or r["page_start"] or 0) + 1))
            ]
            first = ranks[0] if ranks else None
            hits1 += first == 1
            hits3 += bool(first and first <= 3)
            hits8 += first is not None
            rr += 1 / first if first else 0
            print(f"  {'rank ' + str(first) if first else 'MISS  '}  {question}")
    n = len(QUESTIONS)
    print(
        f"[{args.label}] {vtype}: hit@1 {hits1}/{n}  hit@3 {hits3}/{n}  hit@8 {hits8}/{n}  "
        f"MRR {rr / n:.3f}  ({len({p for _, p, _ in QUESTIONS})} documents)"
    )


if __name__ == "__main__":
    main()
