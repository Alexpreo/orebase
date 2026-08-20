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
  const record = body as { enabled?: unknown };
  const enabled = record.enabled !== false;
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  try {
    const clerkId = await resolveClerkId();
    const userId = await ensureUserId(clerkId);
    if (enabled) {
      await sql`
        INSERT INTO app.alerts (user_id, criteria, channel)
        VALUES
          (${userId}, ${JSON.stringify({ watchlist: true })}::jsonb, 'in_app'),
          (${userId}, ${JSON.stringify({ watchlist: true })}::jsonb, 'email')
      `;
    } else {
      await sql`
        DELETE FROM app.alerts
        WHERE user_id = ${userId} AND channel IN ('in_app', 'email')
      `;
    }
    return NextResponse.json({ ok: true, enabled });
  } catch {
    return NextResponse.json({ error: "Could not update alerts." }, { status: 500 });
  }
}
