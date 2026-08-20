import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["resource", "economics", "drill"] as const;
const ACTIONS = ["approve", "reject", "edit", "approve_confident"] as const;

const TABLES = {
  resource: "core.resource_estimates",
  economics: "core.project_economics",
  drill: "core.drill_results",
} as const;

const EDITABLE: Record<(typeof KINDS)[number], Set<string>> = {
  resource: new Set([
    "category",
    "tonnes",
    "grade",
    "contained_metal",
    "cutoff",
    "standard",
    "effective_date",
    "extraction_confidence",
  ]),
  economics: new Set([
    "study_type",
    "effective_date",
    "currency",
    "npv",
    "irr_pct",
    "capex_initial",
    "aisc",
    "mine_life_years",
    "payback_years",
    "metal_price_assumptions",
    "extraction_confidence",
  ]),
  drill: new Set([
    "hole_id",
    "announced_date",
    "from_m",
    "to_m",
    "interval_m",
    "assays",
    "true_width_noted",
    "extraction_confidence",
  ]),
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as { kind?: unknown; id?: unknown; action?: unknown; fields?: unknown };
  const kind = KINDS.find((value) => value === record.kind);
  const action = ACTIONS.find((value) => value === record.action);
  const id = typeof record.id === "string" ? record.id : "";
  if (!action) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }
  if (action !== "approve_confident" && (!kind || !id)) {
    return NextResponse.json({ error: "kind, id, and action are required." }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    if (action === "approve_confident") {
      const min =
        typeof (record as { min_confidence?: unknown }).min_confidence === "number"
          ? (record as { min_confidence: number }).min_confidence
          : 0.7;
      const [resources, economics, drills] = await Promise.all([
        sql`
          UPDATE core.resource_estimates
             SET reviewed = true
           WHERE reviewed = false
             AND extraction_confidence >= ${min}
          RETURNING id
        `,
        sql`
          UPDATE core.project_economics
             SET reviewed = true
           WHERE reviewed = false
             AND extraction_confidence >= ${min}
          RETURNING id
        `,
        sql`
          UPDATE core.drill_results
             SET reviewed = true
           WHERE reviewed = false
             AND extraction_confidence >= ${min}
          RETURNING id
        `,
      ]);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[admin/review] approve_confident", {
          min,
          resources: resources.length,
          economics: economics.length,
          drills: drills.length,
        });
      }
      return NextResponse.json({
        ok: true,
        approved: resources.length + economics.length + drills.length,
      });
    }

    if (!kind) {
      return NextResponse.json({ error: "kind is required." }, { status: 400 });
    }
    const table = TABLES[kind];
    if (action === "reject") {
      await sql.unsafe(`DELETE FROM ${table} WHERE id = $1`, [id]);
      return NextResponse.json({ ok: true });
    }
    if (action === "approve") {
      await sql.unsafe(`UPDATE ${table} SET reviewed = true WHERE id = $1`, [id]);
      return NextResponse.json({ ok: true });
    }

    if (!record.fields || typeof record.fields !== "object") {
      return NextResponse.json({ error: "fields are required for edit." }, { status: 400 });
    }
    const allowed = EDITABLE[kind];
    const entries = Object.entries(record.fields as Record<string, unknown>).filter(
      ([key]) => allowed.has(key),
    );
    if (entries.length === 0) {
      return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
    }
    const assignments = entries.map((_, index) => `${entries[index][0]} = $${index + 2}`);
    const values: Array<string | number | boolean | null> = entries.map(([, value]) => {
      if (value !== null && typeof value === "object") return JSON.stringify(value);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return value;
      }
      return String(value);
    });
    await sql.unsafe(
      `UPDATE ${table} SET ${assignments.join(", ")}, reviewed = true WHERE id = $1`,
      [id, ...values],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the review row." }, { status: 500 });
  }
}
