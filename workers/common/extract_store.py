"""Write validated extraction rows into core.* with document provenance."""

from __future__ import annotations

from datetime import date
from typing import Optional

from psycopg.types.json import Jsonb

from .db import connection
from .extract_schemas import DrillResult, ProjectEconomics, QualifiedPerson, ResourceEstimate


def _has_reviewed(cur, table: str, document_id: str) -> bool:
    cur.execute(
        f"SELECT EXISTS (SELECT 1 FROM {table} WHERE document_id = %s AND reviewed) AS hit;",
        (document_id,),
    )
    return bool(cur.fetchone()["hit"])


def replace_document_facts(
    project_id: str,
    document_id: str,
    *,
    resources: list[ResourceEstimate],
    economics: list[ProjectEconomics],
    drills: list[DrillResult],
    qps: list[QualifiedPerson],
) -> Optional[dict[str, int]]:
    """Swap a document's unreviewed facts for a new extraction in one transaction.

    Returns None and leaves existing facts untouched when the new extraction has no
    validated rows, so an empty or failed re-run can never strip a document. A table
    holding any human-approved row for this document is left as-is (stats value -1):
    replacing it would either drop the approval or duplicate the approved facts.
    """
    if not (resources or economics or drills or qps):
        return None
    tables = (
        ("resources", "core.resource_estimates", _insert_resources, resources),
        ("economics", "core.project_economics", _insert_economics, economics),
        ("drills", "core.drill_results", _insert_drills, drills),
    )
    stats: dict[str, int] = {}
    with connection() as conn, conn.cursor() as cur:
        for key, table, insert, rows in tables:
            if not rows:
                stats[key] = 0  # nothing new for this table; keep what is there
                continue
            if _has_reviewed(cur, table, document_id):
                stats[key] = -1
                continue
            cur.execute(f"DELETE FROM {table} WHERE document_id = %s;", (document_id,))
            stats[key] = insert(cur, project_id, document_id, rows)
        if qps:
            cur.execute("DELETE FROM core.document_qps WHERE document_id = %s;", (document_id,))
        stats["qps"] = _insert_qps(cur, document_id, qps)
    return stats


def _insert_resources(
    cur, project_id: str, document_id: str, rows: list[ResourceEstimate]
) -> int:
    if not rows:
        return 0
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


def _insert_economics(
    cur, project_id: str, document_id: str, rows: list[ProjectEconomics]
) -> int:
    if not rows:
        return 0
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


def _insert_drills(cur, project_id: str, document_id: str, rows: list[DrillResult]) -> int:
    if not rows:
        return 0
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


def _insert_qps(cur, document_id: str, rows: list[QualifiedPerson]) -> int:
    if not rows:
        return 0
    written = 0
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
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (project_id, document_id, event_type)
            WHERE document_id IS NOT NULL
            DO NOTHING;
            """,
            (project_id, document_id, event_type, event_date, summary[:1000]),
        )
