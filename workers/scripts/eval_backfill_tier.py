"""Compare the cheap backfill tier against stored live-tier rows. Writes no facts.

Runs the backfill route (Haiku triage/resources/QPs, Sonnet economics/drills, Sonnet
re-check of low Haiku rows, all via Batch) on N already-extracted reports and diffs the
result against the Sonnet/Opus rows in core.*. Spends real money: ~$0.05-0.15 per report.

    uv run python -m scripts.eval_backfill_tier --n 20 > eval.jsonl
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal

import extractor as ex
from common.config import settings
from common.db import connection, get_document_chunks
from common.extract_schemas import (
    DRILL_TOOL, ECONOMICS_TOOL, QP_TOOL, RESOURCE_TOOL,
    DrillResult, ProjectEconomics, QualifiedPerson, ResourceEstimate,
)

TOL = 0.02
LIGHT, NUMERIC = settings.backfill_model, settings.backfill_numeric_model


def q(sql, args=()):
    with connection() as c, c.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


def close(a, b):
    if a is None or b is None:
        return a is None and b is None
    a, b = float(a), float(b)
    return abs(a - b) <= TOL * max(abs(a), abs(b), 1e-9)


def match(ref, new, key):
    pairs, used = [], set()
    for r in ref:
        for i, n in enumerate(new):
            if i not in used and key(r, n):
                pairs.append((r, n)); used.add(i); break
    return pairs


def agree(a, b):
    keys = set(a or {}) & set(b or {})
    return sum(close(a[k], b[k]) for k in keys), len(keys)


def run_doc(d):
    did = str(d["id"]); ch = get_document_chunks(did)
    base = dict(document_id=did, use_batch=True)
    triage = ex.triage_document(d, ch, False, model=LIGHT, use_batch=True)
    res, res_esc = ex._call_rows_escalating(
        model=LIGHT, escalation_model=NUMERIC, tool=RESOURCE_TOOL, model_cls=ResourceEstimate,
        chunks=ex._select_chunks(ch, ex.RESOURCE_HINTS) or ch[:ex.FALLBACK_CHUNKS], **base)
    eco_ch = ex._select_chunks(ch, ex.ECONOMICS_HINTS)
    eco = ex._call_rows(model=NUMERIC, purpose="extract", tool=ECONOMICS_TOOL, chunks=eco_ch,
                        model_cls=ProjectEconomics, document_id=did, dry_run=False,
                        use_batch=True) if eco_ch else []
    drl_ch = ex._select_chunks(ch, ex.DRILL_HINTS)
    drl = ex._call_rows(model=NUMERIC, purpose="extract", tool=DRILL_TOOL, chunks=drl_ch,
                        model_cls=DrillResult, document_id=did, dry_run=False,
                        use_batch=True)[:ex.MAX_DRILL_ROWS] if drl_ch else []
    qp_ch = ex._select_chunks(ch, ex.QP_HINTS)
    qps = ex._call_rows(model=LIGHT, purpose="extract", tool=QP_TOOL, chunks=qp_ch,
                        model_cls=QualifiedPerson, document_id=did, dry_run=False,
                        use_batch=True) if qp_ch else []

    r_res = q("SELECT category, domain, tonnes, grade, contained_metal FROM core.resource_estimates WHERE document_id=%s", (did,))
    r_eco = q("SELECT study_type, irr_pct, capex_initial, npv FROM core.project_economics WHERE document_id=%s", (did,))
    r_drl = q("SELECT hole_id, from_m FROM core.drill_results WHERE document_id=%s", (did,))
    r_qp = {x["n"] for x in q("SELECT lower(p.name) n FROM core.document_qps x JOIN core.qualified_persons p ON p.id=x.qp_id WHERE x.document_id=%s", (did,))}
    r_names = q("SELECT c.name company, p.name project FROM raw.documents d LEFT JOIN core.companies c ON c.id=d.company_id LEFT JOIN core.projects p ON p.id=d.project_id WHERE d.id=%s", (did,))[0]

    pairs = match(r_res, res, lambda r, n: r["category"] == n.category and close(r["tonnes"], n.tonnes))
    g = [agree(r["grade"], n.grade) for r, n in pairs]
    m = [agree(r["contained_metal"], n.contained_metal) for r, n in pairs]
    unmatched_new = [n for n in res if not any(n is p[1] for p in pairs)]
    epairs = match(r_eco, eco, lambda r, n: (r["study_type"] or "") == (n.study_type or ""))
    e_ok = e_n = 0
    for r, n in epairs:
        for x, y in ((r["irr_pct"], n.irr_pct), (r["capex_initial"], n.capex_initial)):
            if x is not None or y is not None:
                e_n += 1; e_ok += close(x, y)
        a, b = agree(r["npv"], n.npv); e_ok += a; e_n += b
    dpairs = match(r_drl, drl, lambda r, n: (r["hole_id"] or "").lower() == (n.hole_id or "").lower() and close(r["from_m"], n.from_m))
    new_qp = {x.name.lower() for x in qps}
    return {
        "doc": did, "source": d["source"], "pages": d["page_count"],
        "triage": {"company_ref": r_names["company"], "company_new": triage.company_name,
                   "project_ref": r_names["project"], "project_new": triage.project_name},
        "res": {"ref": len(r_res), "new": len(res), "matched": len(pairs), "escalated": res_esc,
                "grade": [sum(x[0] for x in g), sum(x[1] for x in g)],
                "metal": [sum(x[0] for x in m), sum(x[1] for x in m)],
                "low_conf_new": sum(n.extraction_confidence < 0.7 for n in res),
                "unmatched_new": [f"{n.category}|{n.domain}|{n.tonnes:.0f}" for n in unmatched_new[:6]]},
        "eco": {"ref": len(r_eco), "new": len(eco), "matched": len(epairs), "values": [e_ok, e_n]},
        "drill": {"ref": len(r_drl), "new": len(drl), "matched": len(dpairs)},
        "qp": {"ref": len(r_qp), "new": len(new_qp), "overlap": len(r_qp & new_qp)},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--exclude", default="", help="file of doc ids already evaluated")
    args = ap.parse_args()
    skip = set(open(args.exclude).read().split()) if args.exclude else set()
    docs = q("""
        SELECT d.* FROM raw.documents d
         WHERE d.status = 'extracted'
           AND EXISTS (SELECT 1 FROM core.resource_estimates r WHERE r.document_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM core.resource_estimates r WHERE r.document_id = d.id AND r.reviewed)
         ORDER BY d.source, d.page_count DESC""")
    docs = [d for d in docs if str(d["id"])[:8] not in skip]
    half = args.n // 2
    sedar = [d for d in docs if d["source"] == "sedar"]; edgar = [d for d in docs if d["source"] == "edgar"]
    pick = sedar[:: max(1, len(sedar) // half)][:half] + edgar[:: max(1, len(edgar) // half)][:args.n - half]
    started = datetime.now(timezone.utc); t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(pick)) as pool:
        futures = {pool.submit(run_doc, d): d for d in pick}
        for f, d in futures.items():
            try:
                print(json.dumps(f.result(), default=str), flush=True)
            except Exception as e:  # report, don't hide
                print(json.dumps({"doc": str(d["id"]), "error": f"{type(e).__name__}: {e}"[:300]}), flush=True)
    ids = [str(d["id"]) for d in pick]
    new_cost = q("""SELECT model, round(sum(cost_usd)::numeric,4) usd,
                           sum(input_tokens + cache_read_tokens + cache_creation_tokens) inp, sum(output_tokens) outp
                      FROM app.extraction_costs WHERE created_at >= %s AND document_id = ANY(%s::uuid[])
                     GROUP BY 1""", (started, ids))
    # Live-tier list price for the same reading: tokens at Sonnet standard rates ($2 in / $10 out).
    live_equiv = sum(Decimal(r["inp"]) * 2 / 1_000_000 + Decimal(r["outp"]) * 10 / 1_000_000 for r in new_cost)
    print("COST", json.dumps({"by_model": new_cost, "total": sum(r["usd"] for r in new_cost),
                              "live_tier_list_price_same_tokens": round(live_equiv, 2),
                              "docs": len(pick), "minutes": round((time.time() - t0) / 60, 1)}, default=str))


if __name__ == "__main__":
    main()
