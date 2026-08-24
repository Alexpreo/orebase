import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_RE = /https?:\/\/[^\s<>"]+/g;

function extractUrl(blob: string): string | null {
  const matches = blob.match(URL_RE) ?? [];
  const sedar = matches.find((url) => /sedar/i.test(url));
  return (sedar ?? matches[0] ?? "").replace(/[).,]+$/, "") || null;
}

function flattenPayload(body: unknown): {
  subject: string;
  text: string;
  html: string;
  discovered: string;
} {
  const record = (body ?? {}) as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;
  const subject =
    typeof nested.subject === "string"
      ? nested.subject
      : typeof record.subject === "string"
        ? record.subject
        : "";
  const text =
    typeof nested.text === "string"
      ? nested.text
      : typeof record.text === "string"
        ? record.text
        : "";
  const html =
    typeof nested.html === "string"
      ? nested.html
      : typeof record.html === "string"
        ? record.html
        : "";
  const discovered =
    typeof record.discovered_via === "string" ? record.discovered_via : "email_alert";
  return { subject, text, html, discovered };
}

export async function POST(request: Request) {
  const secret = process.env.SEDAR_ALERT_WEBHOOK_SECRET;
  const provided =
    request.headers.get("x-orebase-secret") ??
    new URL(request.url).searchParams.get("secret");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { subject, text, html, discovered } = flattenPayload(body);
  const url = extractUrl(`${subject}\n${text}\n${html}`);
  if (!url) {
    return NextResponse.json({ error: "no filing URL in payload" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM sedar.pending_fetches WHERE external_ref = ${url} LIMIT 1
    `;
    if (existing[0]) {
      return NextResponse.json({ ok: true, pending_id: existing[0].id, duplicate: true });
    }
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO sedar.pending_fetches (
        source, document_type, filed_date, external_ref, discovered_via, status
      ) VALUES (
        'sedar', ${subject.slice(0, 300) || "SEDAR+ alert"}, CURRENT_DATE, ${url}, ${discovered}, 'pending'
      )
      RETURNING id
    `;
    if (process.env.NODE_ENV !== "production") {
      console.debug("[ingest/sedar-alert]", { duplicate: false, hasUrl: true });
    }
    return NextResponse.json({
      ok: true,
      pending_id: inserted[0]?.id ?? null,
      duplicate: false,
    });
  } catch {
    return NextResponse.json({ error: "Could not enqueue fetch." }, { status: 500 });
  }
}
