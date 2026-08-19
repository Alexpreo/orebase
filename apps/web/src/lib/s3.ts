import "server-only";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET;
const region = process.env.AWS_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

/**
 * Presigned URLs are short-lived because they are bearer tokens: anyone holding one can
 * read the object until it expires, with no further auth check. Long enough to open a
 * document and page through it, short enough that a leaked URL is quickly worthless.
 */
const SIGNED_URL_TTL_SECONDS = 300;

const globalForS3 = globalThis as unknown as { __obS3?: S3Client | null };

function getClient(): S3Client | null {
  if (globalForS3.__obS3 !== undefined) {
    return globalForS3.__obS3;
  }

  if (!bucket) {
    globalForS3.__obS3 = null;
    return null;
  }

  // Omitting credentials entirely lets the SDK fall back to its default chain (instance
  // role, shared config), which is how this runs in deployment.
  globalForS3.__obS3 = new S3Client({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return globalForS3.__obS3;
}

export function isS3Configured(): boolean {
  return Boolean(bucket);
}

/** Strips the `s3://bucket/` prefix that documents.storage_path is stored with. */
export function storageKeyFromPath(storagePath: string): string {
  if (!storagePath.startsWith("s3://")) {
    return storagePath;
  }
  const withoutScheme = storagePath.slice("s3://".length);
  const slash = withoutScheme.indexOf("/");
  return slash === -1 ? withoutScheme : withoutScheme.slice(slash + 1);
}

/**
 * Returns a temporary direct-download URL for an object, or null when S3 is unconfigured.
 *
 * Not used for in-app viewing: a presigned URL points at a different origin, so the
 * browser applies CORS and blocks it unless the bucket carries a rule for every origin
 * the app is served from. Kept for "download the original" style links, where a plain
 * navigation is not subject to CORS.
 */
export async function getDocumentUrl(storagePath: string): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) {
    return null;
  }

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKeyFromPath(storagePath),
      ResponseContentType: "application/pdf",
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

export type ObjectStream = {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentRange?: string;
  contentType?: string;
  /** True when S3 honoured a Range header and returned a partial body. */
  partial: boolean;
};

/**
 * Fetches an object, optionally a byte range, as a web stream.
 *
 * Serving bytes through the app keeps the viewer same-origin (no CORS, no bucket policy
 * to maintain per environment) and never exposes a bucket URL to the browser. Forwarding
 * the Range header preserves the property that mattered about presigned URLs: pdf.js
 * fetches only the pages it displays instead of a whole 250-page report.
 */
export async function getDocumentStream(
  storagePath: string,
  range?: string | null,
): Promise<ObjectStream | null> {
  const client = getClient();
  if (!client || !bucket) {
    return null;
  }

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKeyFromPath(storagePath),
      ...(range ? { Range: range } : {}),
    }),
  );

  if (!response.Body) {
    return null;
  }

  return {
    body: response.Body.transformToWebStream(),
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    contentType: response.ContentType,
    partial: Boolean(response.ContentRange),
  };
}
