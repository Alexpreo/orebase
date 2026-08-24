import { NextResponse } from "next/server";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import { ensureDefaultWatchlist } from "@/lib/intel";
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
  const record = body as { projectId?: unknown; companyId?: unknown };
  const projectId = typeof record.projectId === "string" ? record.projectId : null;
  const companyId = typeof record.companyId === "string" ? record.companyId : null;
  if (!projectId && !companyId) {
    return NextResponse.json({ error: "projectId or companyId is required." }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    const clerkId = await resolveClerkId();
    const userId = await ensureUserId(clerkId);
    const watchlist = await ensureDefaultWatchlist(userId);
    const existing = projectId
      ? await sql<{ id: string }[]>`
          SELECT id FROM app.watchlist_items
           WHERE watchlist_id = ${watchlist.id} AND project_id = ${projectId}
           LIMIT 1
        `
      : await sql<{ id: string }[]>`
          SELECT id FROM app.watchlist_items
           WHERE watchlist_id = ${watchlist.id} AND company_id = ${companyId}
           LIMIT 1
        `;
    if (!existing[0]) {
      await sql`
        INSERT INTO app.watchlist_items (watchlist_id, project_id, company_id)
        VALUES (${watchlist.id}, ${projectId}, ${companyId})
      `;
    }
    return NextResponse.json({ ok: true, watchlistId: watchlist.id });
  } catch {
    return NextResponse.json({ error: "Could not add watchlist item." }, { status: 500 });
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
      DELETE FROM app.watchlist_items
      WHERE id = ${id}
        AND watchlist_id IN (
          SELECT id FROM app.watchlists WHERE user_id = ${userId}
        )
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not remove watchlist item." }, { status: 500 });
  }
}
