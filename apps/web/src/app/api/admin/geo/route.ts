import { NextResponse } from "next/server";
import { adminApiGuard } from "@/lib/admin-auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const record = body as { occurrenceId?: unknown; projectId?: unknown };
  const occurrenceId = typeof record.occurrenceId === "string" ? record.occurrenceId : "";
  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  if (!occurrenceId || !projectId) {
    return NextResponse.json(
      { error: "occurrenceId and projectId are required." },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    const occ = await sql<{ lat: number; lng: number }[]>`
      SELECT lat, lng FROM core.geo_occurrences WHERE id = ${occurrenceId}
    `;
    if (!occ[0]) {
      return NextResponse.json({ error: "Occurrence not found." }, { status: 404 });
    }
    await sql`
      UPDATE core.geo_occurrences SET project_id = ${projectId} WHERE id = ${occurrenceId}
    `;
    await sql`
      UPDATE core.projects
         SET lat = COALESCE(lat, ${occ[0].lat}),
             lng = COALESCE(lng, ${occ[0].lng}),
             updated_at = now()
       WHERE id = ${projectId}
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not link occurrence." }, { status: 500 });
  }
}
