import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";
import type { Citation } from "@/lib/chat-types";

export const DOCUMENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INLINE_CITATION_RE =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+p\.(\d+)(?:-(\d+))?\]/gi;

export function isDocumentUuid(value: string): boolean {
  return DOCUMENT_UUID_RE.test(value);
}

export function pageLabel(pageStart: number | null, pageEnd: number | null): string {
  if (pageStart == null) return "n/a";
  if (pageEnd != null && pageEnd !== pageStart) {
    return `${pageStart}-${pageEnd}`;
  }
  return String(pageStart);
}

export function citationLabel(
  documentId: string,
  pageStart: number | null,
  pageEnd: number | null,
): string {
  return `[${documentId.slice(0, 8)} p.${pageLabel(pageStart, pageEnd)}]`;
}

export function citationHref(citation: Citation): string {
  const page = citation.pageStart ?? 1;
  return `/documents/${citation.documentId}?page=${page}`;
}

type ChunkLike = {
  document_id?: unknown;
  page_start?: unknown;
  page_end?: unknown;
};

function asChunk(value: unknown): ChunkLike | null {
  if (typeof value !== "object" || value == null) return null;
  return value as ChunkLike;
}

function addCitation(
  citations: Citation[],
  seen: Set<string>,
  documentId: string,
  pageStart: number | null,
  pageEnd: number | null,
): void {
  if (!isDocumentUuid(documentId)) return;
  const label = citationLabel(documentId, pageStart, pageEnd);
  if (seen.has(label)) return;
  seen.add(label);
  citations.push({ label, documentId, pageStart, pageEnd });
}

function pageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectFromChunks(
  citations: Citation[],
  seen: Set<string>,
  chunks: unknown,
): void {
  if (!Array.isArray(chunks)) return;
  for (const item of chunks) {
    const chunk = asChunk(item);
    if (!chunk || typeof chunk.document_id !== "string") continue;
    addCitation(
      citations,
      seen,
      chunk.document_id,
      pageNumber(chunk.page_start),
      pageNumber(chunk.page_end),
    );
  }
}

function collectFromToolOutput(
  citations: Citation[],
  seen: Set<string>,
  output: unknown,
): void {
  if (typeof output !== "object" || output == null) return;
  const record = output as Record<string, unknown>;
  collectFromChunks(citations, seen, record.chunks);
  if (typeof record.document_id === "string") {
    addCitation(citations, seen, record.document_id, null, null);
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      const chunk = asChunk(row);
      if (chunk && typeof chunk.document_id === "string") {
        addCitation(citations, seen, chunk.document_id, null, null);
      }
    }
  }
}

export function collectCitations(messages: Array<Pick<UIMessage, "parts">>): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text") {
        INLINE_CITATION_RE.lastIndex = 0;
        for (const match of part.text.matchAll(INLINE_CITATION_RE)) {
          const documentId = match[1];
          const pageStart = Number.parseInt(match[2], 10);
          const pageEnd = match[3] ? Number.parseInt(match[3], 10) : pageStart;
          addCitation(citations, seen, documentId, pageStart, pageEnd);
        }
      }
      if (isToolUIPart(part) && part.state === "output-available") {
        collectFromToolOutput(citations, seen, part.output);
      }
    }
  }

  return citations;
}
