import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import { persistChat } from "@/lib/chat";
import { collectCitations, isDocumentUuid } from "@/lib/citations";
import {
  createSearchDocumentsTool,
  getDocumentTool,
  queryDatabaseTool,
} from "@/lib/chat-tools";
import type { ChatSearchFilters, OreBaseUIMessage } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_OUTPUT_TOKENS = 2048;
const MAX_TOOL_STEPS = 8;

function parseFilters(raw: unknown): ChatSearchFilters {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const company = typeof record.company === "string" ? record.company.trim() : "";
  const docType = typeof record.docType === "string" ? record.docType.trim() : "";
  const dateFrom = typeof record.dateFrom === "string" ? record.dateFrom.trim() : "";
  const dateTo = typeof record.dateTo === "string" ? record.dateTo.trim() : "";
  return {
    company: company || undefined,
    docType: docType && docType !== "all" ? docType : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
}

function filterPrompt(filters: ChatSearchFilters): string {
  const parts: string[] = [];
  if (filters.company) parts.push(`company=${filters.company}`);
  if (filters.docType) parts.push(`doc_type=${filters.docType}`);
  if (filters.dateFrom) parts.push(`date_from=${filters.dateFrom}`);
  if (filters.dateTo) parts.push(`date_to=${filters.dateTo}`);
  if (parts.length === 0) return "";
  return `\nThe user pinned retrieval filters: ${parts.join(", ")}. Pass these to search_documents unless they contradict the question.`;
}

const SYSTEM_PROMPT = `You are OreBase, a mining-intelligence research assistant.

Tools:
- search_documents: hybrid search over indexed technical-report chunks. Call this before answering any factual question. Pass company, doc_type, or date filters when the user names them.
- get_document: load more pages from a document_id returned by search_documents.
- query_database: read-only SQL against core.v_* views. Those views are empty until structured extraction has run; if a query returns no rows, say so and fall back to search_documents.

Rules you MUST follow:
- Answer ONLY using tool results. Do not use outside knowledge.
- Cite every factual claim inline using the format [docId p.X], copying the exact document UUID and page shown in the tool output.
- If the answer is not contained in the tool results, reply exactly: "That information is not in the database." Do not guess.
- End every response with this line on its own: "Disclaimer: This is not investment advice."`;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as { id?: unknown; messages?: unknown; filters?: unknown };
  const chatId = typeof record.id === "string" ? record.id : "";
  const messages = record.messages as OreBaseUIMessage[] | undefined;
  const filters = parseFilters(record.filters);

  if (!isDocumentUuid(chatId)) {
    return Response.json({ error: "A valid chat id is required." }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages must be a non-empty array." }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Chat is unavailable: ANTHROPIC_API_KEY is not set." },
      { status: 503 },
    );
  }
  if (!process.env.VOYAGE_API_KEY) {
    return Response.json(
      { error: "Embeddings are unavailable: VOYAGE_API_KEY is not set." },
      { status: 503 },
    );
  }
  if (!process.env.DATABASE_URL_POOLED && !process.env.DATABASE_URL) {
    return Response.json(
      { error: "Database is not configured: set DATABASE_URL_POOLED." },
      { status: 503 },
    );
  }

  const tools = {
    search_documents: createSearchDocumentsTool(filters),
    get_document: getDocumentTool,
    query_database: queryDatabaseTool,
  };

  if (process.env.NODE_ENV !== "production") {
    console.debug("[chat] request filters", {
      chatId,
      company: filters.company ?? null,
      docType: filters.docType ?? null,
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
      messageCount: messages.length,
    });
  }

  const modelMessages = await convertToModelMessages(messages, {
    tools,
    ignoreIncompleteToolCalls: true,
  });

  const result = streamText({
    model: anthropic(ANTHROPIC_MODEL),
    system: SYSTEM_PROMPT + filterPrompt(filters),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      onError: () => "Something went wrong.",
      onEnd: async ({ messages: nextMessages }) => {
        const persisted = nextMessages.map((message) => {
          if (message.role !== "assistant") return message;
          return {
            ...message,
            metadata: {
              ...message.metadata,
              citations: collectCitations([message]),
            },
          };
        });
        try {
          await persistChat(chatId, persisted);
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[chat] persist failed", {
              chatId,
              messageCount: persisted.length,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }
      },
    }),
  });
}
