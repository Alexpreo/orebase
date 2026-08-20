import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { putDocumentObject } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDF_MAGIC = Buffer.from("%PDF");
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const DOC_TYPES = new Set(["ni43101", "pea", "pfs", "fs", "press_release", "mda", "financials"]);

export async function POST(request: Request) {
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Use the worker CLI for large reports.`,
      },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 5 || !bytes.subarray(0, 4).equals(PDF_MAGIC)) {
    return NextResponse.json({ error: "File is not a PDF." }, { status: 400 });
  }

  const title =
    (typeof form.get("title") === "string" && form.get("title")?.toString().trim()) ||
    file.name.replace(/\.pdf$/i, "");
  const rawType = (form.get("doc_type")?.toString() || "ni43101").toLowerCase();
  const docType = DOC_TYPES.has(rawType) ? rawType : "ni43101";
  const filedAtRaw = form.get("filed_at")?.toString() || "";
  const filedAt = /^\d{4}-\d{2}-\d{2}$/.test(filedAtRaw) ? filedAtRaw : null;
  const issuer = form.get("issuer")?.toString().trim() || "";

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM raw.documents WHERE sha256 = ${sha256} LIMIT 1
  `;
  if (existing[0]) {
    return NextResponse.json({ ok: true, document_id: existing[0].id, duplicate: true });
  }

  const stamp = new Date().toISOString().slice(0, 7).replace("-", "/");
  const key = `sedar/${stamp}/${sha256.slice(0, 16)}.pdf`;
  const storagePath = await putDocumentObject(key, bytes, "application/pdf");
  if (!storagePath) {
    return NextResponse.json({ error: "S3 is not configured." }, { status: 503 });
  }

  const displayTitle = issuer ? `${issuer} — ${title}` : title;
  try {
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO raw.documents (
        source, source_url, external_id, doc_type, title, filed_at,
        sha256, storage_path, source_content_type, status
      ) VALUES (
        'sedar',
        'manual-upload',
        ${`manual:${sha256}`},
        ${docType},
        ${displayTitle},
        ${filedAt},
        ${sha256},
        ${storagePath},
        'application/pdf',
        'ingested'
      )
      ON CONFLICT (sha256) DO NOTHING
      RETURNING id
    `;
    const documentId = inserted[0]?.id;
    if (!documentId) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    await sql`
      INSERT INTO raw.processing_jobs (document_id, job_type, status)
      VALUES (${documentId}, 'parse', 'pending')
    `;

    if (process.env.NODE_ENV !== "production") {
      console.debug("[admin/ingest]", { docType, bytes: bytes.length, duplicate: false });
    }

    return NextResponse.json({ ok: true, document_id: documentId, duplicate: false });
  } catch {
    return NextResponse.json({ error: "Could not record the filing." }, { status: 500 });
  }
}
