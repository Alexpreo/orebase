import { NextResponse } from "next/server";
import { adminApiGuard } from "@/lib/admin-auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["resource", "economics", "drill"] as const;
const ACTIONS = ["approve", "reject", "edit", "approve_confident", "link"] as const;

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
  const denied = await adminApiGuard();
  if (denied) return denied;

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
  if (action !== "approve_confident" && action !== "link" && (!kind || !id)) {
    return NextResponse.json({ error: "kind, id, and action are required." }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    if (action === "link") {
      const documentId =
        typeof (record as { documentId?: unknown }).documentId === "string"
          ? (record as { documentId: string }).documentId
          : "";
      const companyName =
        typeof (record as { companyName?: unknown }).companyName === "string"
          ? (record as { companyName: string }).companyName.trim()
          : "";
      const projectName =
        typeof (record as { projectName?: unknown }).projectName === "string"
          ? (record as { projectName: string }).projectName.trim()
          : "";
      const sedarProfile =
        typeof (record as { sedarProfile?: unknown }).sedarProfile === "string"
          ? (record as { sedarProfile: string }).sedarProfile.trim()
          : "";
      const companyIdIn =
        typeof (record as { companyId?: unknown }).companyId === "string"
          ? (record as { companyId: string }).companyId
          : "";
      const projectIdIn =
        typeof (record as { projectId?: unknown }).projectId === "string"
          ? (record as { projectId: string }).projectId
          : "";
      if (!documentId || (!companyIdIn && !companyName) || (!projectIdIn && !projectName)) {
        return NextResponse.json(
          { error: "documentId, company, and project are required." },
          { status: 400 },
        );
      }

      let companyId = companyIdIn;
      if (!companyId) {
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM core.companies WHERE lower(name) = lower(${companyName}) LIMIT 2
        `;
        if (existing.length > 1) {
          return NextResponse.json(
            { error: "Ambiguous company name; pick an existing id." },
            { status: 409 },
          );
        }
        if (existing[0]) {
          companyId = existing[0].id;
        } else {
          const created = await sql<{ id: string }[]>`
            INSERT INTO core.companies (name, sedar_profile)
            VALUES (${companyName}, ${sedarProfile || null})
            RETURNING id
          `;
          companyId = created[0]?.id ?? "";
        }
      }
      if (sedarProfile) {
        await sql`
          UPDATE core.companies
             SET sedar_profile = COALESCE(sedar_profile, ${sedarProfile})
           WHERE id = ${companyId}
        `;
        await sql`
          UPDATE sedar.sedar_issuers
             SET company_id = ${companyId}
           WHERE profile_number = ${sedarProfile}
        `;
      }

      let projectId = projectIdIn;
      if (!projectId) {
        const existingProject = await sql<{ id: string }[]>`
          SELECT id FROM core.projects
           WHERE company_id = ${companyId} AND lower(name) = lower(${projectName})
           LIMIT 1
        `;
        if (existingProject[0]) {
          projectId = existingProject[0].id;
        } else {
          const createdProject = await sql<{ id: string }[]>`
            INSERT INTO core.projects (company_id, name)
            VALUES (${companyId}, ${projectName})
            RETURNING id
          `;
          projectId = createdProject[0]?.id ?? "";
        }
      }

      await sql`
        UPDATE raw.documents
           SET company_id = ${companyId}, project_id = ${projectId}
         WHERE id = ${documentId}
      `;
      if (process.env.NODE_ENV !== "production") {
        console.debug("[admin/review] link", { documentId, companyId, projectId });
      }
      return NextResponse.json({ ok: true, companyId, projectId });
    }

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
