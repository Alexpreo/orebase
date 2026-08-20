import { NextResponse } from "next/server";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const record = body as { name?: unknown; criteria?: unknown };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name || !record.criteria || typeof record.criteria !== "object") {
    return NextResponse.json({ error: "name and criteria are required." }, { status: 400 });
  }
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  try {
    const clerkId = await resolveClerkId();
    const userId = await ensureUserId(clerkId);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.saved_filters (user_id, name, criteria)
      VALUES (${userId}, ${name}, ${JSON.stringify(record.criteria)}::jsonb)
      RETURNING id
    `;
    return NextResponse.json({ ok: true, id: rows[0]?.id });
  } catch {
    return NextResponse.json({ error: "Could not save filter set." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const id = typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  try {
    const clerkId = await resolveClerkId();
    const userId = await ensureUserId(clerkId);
    await sql`
      DELETE FROM app.saved_filters
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete filter set." }, { status: 500 });
  }
}
