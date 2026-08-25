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
  const record = body as { documentId?: unknown; projectId?: unknown };
  const documentId =
    typeof record.documentId === "string" ? record.documentId : "";
  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  if (!documentId && !projectId) {
    return NextResponse.json(
      { error: "documentId or projectId is required." },
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
    const docs = documentId
      ? await sql<{ id: string }[]>`
          SELECT id FROM raw.documents WHERE id = ${documentId}
        `
      : await sql<{ id: string }[]>`
          SELECT id
            FROM raw.documents
           WHERE project_id = ${projectId}
             AND status IN ('indexed', 'triaged', 'extracted')
             AND doc_type IN ('ni43101', 'sk1300', 'jorc', 'pea', 'pfs', 'fs')
        `;
    if (docs.length === 0) {
      return NextResponse.json({ error: "No matching documents." }, { status: 404 });
    }
    let queued = 0;
    for (const doc of docs) {
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO raw.processing_jobs (document_id, job_type, status)
        SELECT ${doc.id}, 'full_extract', 'pending'
         WHERE NOT EXISTS (
            SELECT 1
              FROM raw.processing_jobs
             WHERE document_id = ${doc.id}
               AND job_type = 'full_extract'
               AND status IN ('pending', 'running', 'done')
         )
        RETURNING id
      `;
      queued += inserted.length;
    }
    if (process.env.NODE_ENV !== "production") {
      console.debug("[admin/extract]", { documentId, projectId, queued, docs: docs.length });
    }
    return NextResponse.json({ ok: true, queued });
  } catch {
    return NextResponse.json({ error: "Could not enqueue extract." }, { status: 500 });
  }
}
