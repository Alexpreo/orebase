import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let documentId: unknown;
  try {
    const body = await request.json();
    documentId = body?.documentId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof documentId !== "string" || documentId.length === 0) {
    return NextResponse.json(
      { error: "documentId is required." },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 },
    );
  }

  try {
    const reset = await sql.begin(async (tx) => {
      const jobs = await tx`
        UPDATE raw.processing_jobs
        SET status = 'pending', attempts = 0, last_error = NULL, updated_at = now()
        WHERE document_id = ${documentId} AND status = 'failed'
        RETURNING id
      `;
      await tx`
        UPDATE raw.documents
        SET status = 'ingested'
        WHERE id = ${documentId} AND status = 'failed'
      `;
      return jobs.length;
    });

    return NextResponse.json({ ok: true, jobsReset: reset });
  } catch {
    return NextResponse.json(
      { error: "Retry failed. Could not update processing jobs." },
      { status: 500 },
    );
  }
}
