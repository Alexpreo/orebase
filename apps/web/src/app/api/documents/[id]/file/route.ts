import { NextResponse } from "next/server";
import { getDocument } from "@/lib/documents";
import { getDocumentStream, isS3Configured } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PDF_CONTENT_TYPE = "application/pdf";

/**
 * Streams a document's rendered PDF from S3 on the app's own origin.
 *
 * Same-origin matters: pdf.js reads via fetch, so a cross-origin S3 URL would need a CORS
 * rule on the bucket for every origin the app runs on. Serving here also keeps the bucket
 * unadvertised, and access stays gated by the Clerk middleware rather than by possession
 * of a presigned URL. Range headers are forwarded so only the displayed pages transfer.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: "Document storage is not configured. Set S3_BUCKET." },
      { status: 503 },
    );
  }

  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (!document.storage_path) {
    return NextResponse.json(
      { error: "Document has no stored file." },
      { status: 404 },
    );
  }

  const range = request.headers.get("range");

  let object;
  try {
    object = await getDocumentStream(document.storage_path, range);
  } catch {
    return NextResponse.json(
      { error: "Could not read this document from storage." },
      { status: 502 },
    );
  }

  if (!object) {
    return NextResponse.json({ error: "Document file is empty." }, { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": object.contentType ?? PDF_CONTENT_TYPE,
    // Without this pdf.js assumes the whole file must be downloaded up front.
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
    // Documents are immutable once ingested, but they are private, so only the user's own
    // browser may keep a copy.
    "Cache-Control": "private, max-age=3600",
  });
  if (object.contentLength !== undefined) {
    headers.set("Content-Length", String(object.contentLength));
  }
  if (object.contentRange) {
    headers.set("Content-Range", object.contentRange);
  }

  return new NextResponse(object.body, {
    status: object.partial ? 206 : 200,
    headers,
  });
}
