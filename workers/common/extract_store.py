"""Write validated extraction rows into core.* with document provenance."""

from __future__ import annotations

from datetime import date
from typing import Optional

from psycopg.types.json import Jsonb

from .db import connection
from .extract_schemas import DrillResult, ProjectEconomics, QualifiedPerson, ResourceEstimate


def clear_document_facts(document_id: str) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM core.resource_estimates WHERE document_id = %s;", (document_id,))
        cur.execute("DELETE FROM core.project_economics WHERE document_id = %s;", (document_id,))
        cur.execute("DELETE FROM core.drill_results WHERE document_id = %s;", (document_id,))
        cur.execute("DELETE FROM core.document_qps WHERE document_id = %s;", (document_id,))
        cur.execute("DELETE FROM core.project_events WHERE document_id = %s;", (document_id,))


def insert_resources(
    project_id: str, document_id: str, rows: list[ResourceEstimate]
) -> int:
    if not rows:
        return 0
    with connection() as conn, conn.cursor() as cur:
        for row in rows:
            if row.tonnes <= 0:
                continue
            cur.execute(
                """
                INSERT INTO core.resource_estimates (
                    project_id, document_id, effective_date, category, tonnes, grade,
                    contained_metal, cutoff, standard, extraction_confidence, reviewed
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false);
                """,
                (
                    project_id,
                    document_id,
                    row.effective_date,
                    row.category,
                    row.tonnes,
                    Jsonb(row.grade),
                    Jsonb(row.contained_metal),
                    row.cutoff,
                    row.standard,
                    row.extraction_confidence,
                ),
            )
    return len(rows)


def insert_economics(
    project_id: str, document_id: str, rows: list[ProjectEconomics]
) -> int:
    if not rows:
        return 0
    with connection() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO core.project_economics (
                    project_id, document_id, study_type, effective_date, currency, npv,
                    irr_pct, capex_initial, aisc, mine_life_years, payback_years,
                    metal_price_assumptions, extraction_confidence, reviewed
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false);
                """,
                (
                    project_id,
                    document_id,
                    row.study_type,
                    row.effective_date,
                    row.currency,
                    Jsonb(row.npv),
                    row.irr_pct,
                    row.capex_initial,
                    Jsonb(row.aisc),
                    row.mine_life_years,
                    row.payback_years,
                    Jsonb(row.metal_price_assumptions),
                    row.extraction_confidence,
                ),
            )
    return len(rows)


def insert_drills(project_id: str, document_id: str, rows: list[DrillResult]) -> int:
    if not rows:
        return 0
    with connection() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO core.drill_results (
                    project_id, document_id, hole_id, announced_date, from_m, to_m,
                    interval_m, assays, true_width_noted, extraction_confidence, reviewed
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false);
                """,
                (
                    project_id,
                    document_id,
                    row.hole_id,
                    row.announced_date,
                    row.from_m,
                    row.to_m,
                    row.interval_m,
                    Jsonb(row.assays),
                    row.true_width_noted,
                    row.extraction_confidence,
                ),
            )
    return len(rows)


def insert_qps(document_id: str, rows: list[QualifiedPerson]) -> int:
    if not rows:
        return 0
    written = 0
    with connection() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                SELECT id FROM core.qualified_persons
                 WHERE lower(name) = lower(%s)
                 LIMIT 1;
                """,
                (row.name,),
            )
            existing = cur.fetchone()
            if existing:
                qp_id = existing["id"]
            else:
                cur.execute(
                    """
                    INSERT INTO core.qualified_persons (name, designation, firm)
                    VALUES (%s, %s, %s)
                    RETURNING id;
                    """,
                    (row.name, row.designation, row.firm),
                )
                qp_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO core.document_qps (document_id, qp_id, role)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING;
                """,
                (document_id, qp_id, row.role or ""),
            )
            written += 1
    return written


def insert_project_event(
    project_id: str,
    document_id: str,
    event_type: str,
    event_date: Optional[date],
    summary: str,
) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO core.project_events (project_id, document_id, event_type, event_date, summary)
            VALUES (%s, %s, %s, %s, %s);
            """,
            (project_id, document_id, event_type, event_date, summary[:1000]),
        )
