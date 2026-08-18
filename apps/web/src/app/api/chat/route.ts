import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import {
  DEFAULT_TOP_K,
  VOYAGE_EMBEDDING_DIM,
  embedQuery,
  hybridRetrieve,
  type RetrievedChunk,
} from "@/lib/retrieval";
import type { Citation } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are OreBase, a mining-intelligence research assistant.

Rules you MUST follow:
- Answer ONLY using the information in the provided context sources. Do not use outside knowledge.
- Cite every factual claim inline using the format [docId p.X], copying the exact docId and page shown for the source you used.
- If the answer is not contained in the context, reply exactly: "That information is not in the database." Do not guess.
- End every response with this line on its own: "Disclaimer: This is not investment advice."`;

function pageLabel(chunk: RetrievedChunk): string {
  if (chunk.page_start == null) return "n/a";
  if (chunk.page_end != null && chunk.page_end !== chunk.page_start) {
    return `${chunk.page_start}-${chunk.page_end}`;
  }
  return String(chunk.page_start);
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      return [
        `Source ${index + 1}`,
        `docId: ${chunk.document_id}`,
        `page: ${pageLabel(chunk)}`,
        `content: ${chunk.content}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function toCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const chunk of chunks) {
    const label = `[${chunk.document_id.slice(0, 8)} p.${pageLabel(chunk)}]`;
    if (seen.has(label)) continue;
    seen.add(label);
    citations.push({
      label,
      documentId: chunk.document_id,
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
    });
  }
  return citations;
}

async function callClaude(query: string, context: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const userContent = `Context sources:\n\n${context}\n\nQuestion: ${query}`;

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic request failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  return text && text.length > 0 ? text : "That information is not in the database.";
}

export async function POST(request: Request) {
  let query: unknown;
  try {
    const body = await request.json();
    query = body?.message;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { error: "A non-empty message is required." },
      { status: 400 },
    );
  }
  const trimmedQuery = query.trim();

  if (!process.env.VOYAGE_API_KEY) {
    return NextResponse.json(
      { error: "Embeddings are unavailable: VOYAGE_API_KEY is not set." },
      { status: 503 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Chat is unavailable: ANTHROPIC_API_KEY is not set." },
      { status: 503 },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json(
      { error: "Database is not configured: set DATABASE_URL_POOLED." },
      { status: 503 },
    );
  }

  try {
    const embedding = await embedQuery(trimmedQuery);
    const chunks = await hybridRetrieve(
      sql,
      embedding,
      trimmedQuery,
      DEFAULT_TOP_K,
    );

    if (process.env.NODE_ENV !== "production") {
      console.debug("[chat] retrieval", {
        queryLength: trimmedQuery.length,
        embeddingDims: embedding.length,
        expectedDims: VOYAGE_EMBEDDING_DIM,
        topK: DEFAULT_TOP_K,
        totalChunks: chunks.length,
      });
    }

    if (chunks.length === 0) {
      return NextResponse.json({
        answer:
          "That information is not in the database.\n\nDisclaimer: This is not investment advice.",
        citations: [],
      });
    }

    const context = buildContext(chunks);
    const answer = await callClaude(trimmedQuery, context);

    return NextResponse.json({
      answer,
      citations: toCitations(chunks),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error handling chat.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
