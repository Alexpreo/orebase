"""Attach a project to filings that have none, with a triage-only model pass (no fact extraction).

Reads the first pages with the backfill model, matches or creates the project under the
filing's already-linked company, and stores the summary. Status is left alone, so the
filing's queued extract job still runs later. Stops once this run's spend reaches --cap.

    uv run python -m scripts.link_projects                 # dry run: estimated cost only
    uv run python -m scripts.link_projects --apply --cap 5
"""

from __future__ import annotations

import argparse
from decimal import Decimal

from common.config import settings
from common.db import connection, get_document_chunks, update_document_entities
from common.resolve import upsert_project
from extractor import triage_document


def run_spend(cur, since) -> Decimal:
    cur.execute(
        "SELECT coalesce(sum(cost_usd), 0) AS s FROM app.extraction_costs WHERE created_at >= %s AND purpose = 'triage'",
        (since,),
    )
    return Decimal(cur.fetchone()["s"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="call the model and write links")
    parser.add_argument("--cap", type=Decimal, default=Decimal("5"), help="stop at this USD spend")
    args = parser.parse_args()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT now() AS t")
        started = cur.fetchone()["t"]
        cur.execute(
            """
            SELECT d.id, d.title, d.doc_type, d.filed_at, d.company_id, c.name AS company_name
              FROM raw.documents d JOIN core.companies c ON c.id = d.company_id
             WHERE d.project_id IS NULL
             ORDER BY d.filed_at DESC NULLS LAST
            """
        )
        docs = cur.fetchall()

    model = settings.backfill_model
    print(f"{len(docs)} filings with a company but no project · model {model} · cap ${args.cap}")
    linked = no_name = refused = 0
    est = Decimal(0)
    for i, doc in enumerate(docs, 1):
        if args.apply:
            with connection() as conn, conn.cursor() as cur:
                spent = run_spend(cur, started)
            if spent >= args.cap:
                print(f"cap reached at ${spent:.2f} after {i - 1} filings; stopping")
                break
        chunks = get_document_chunks(str(doc["id"]))
        if not chunks:
            continue
        try:
            triage = triage_document(doc, chunks, dry_run=not args.apply, model=model)
        except Exception as exc:  # noqa: BLE001 - one bad filing must not stop the run
            print(f"  skip {doc['id']}: {exc}")
            continue
        if not args.apply:
            # dry run: triage_document returned a title fallback; price the call instead
            from common.claude import estimate_cost_usd
            from extractor import TRIAGE_PAGE_LIMIT, _first_pages, _format_chunks

            est += estimate_cost_usd(model, len(_format_chunks(_first_pages(chunks, TRIAGE_PAGE_LIMIT))) // 4 + 600, 300)
            continue
        if not triage.project_name:
            no_name += 1
            update_document_entities(str(doc["id"]), summary=triage.summary[:500])
            continue
        project_id = upsert_project(
            company_id=str(doc["company_id"]),
            company_name=doc["company_name"],
            name=triage.project_name,
            country=triage.country,
            region=triage.region,
            commodities=triage.commodities,
            stage=triage.stage,
        )
        update_document_entities(str(doc["id"]), project_id=project_id, summary=triage.summary[:500])
        if project_id:
            linked += 1
        else:
            refused += 1
        if i % 25 == 0:
            print(f"  {i}/{len(docs)} · linked {linked}")

    if args.apply:
        with connection() as conn, conn.cursor() as cur:
            spent = run_spend(cur, started)
        print(f"linked {linked} · no project named {no_name} · ambiguous/refused {refused} · spent ${spent:.2f}")
    else:
        print(f"estimated cost ${est:.2f}. Dry run; pass --apply.")


if __name__ == "__main__":
    main()
