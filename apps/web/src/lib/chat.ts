import "server-only";
import type { Sql } from "postgres";
import { auth } from "@clerk/nextjs/server";
import { collectCitations, isDocumentUuid } from "@/lib/citations";
import { getSql } from "@/lib/db";
import type { ChatSummary, Citation, OreBaseUIMessage } from "@/lib/chat-types";

export const LOCAL_DEV_CLERK_ID = "local-dev";
const MAX_CHAT_TITLE_LENGTH = 80;
const CHAT_LIST_LIMIT = 30;

type StoredMessage = {
  id: string;
  role: string;
  content: string | null;
  citations: unknown;
};

export async function resolveClerkId(): Promise<string> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return LOCAL_DEV_CLERK_ID;
  }
  try {
    const { userId } = await auth();
    return userId ?? LOCAL_DEV_CLERK_ID;
  } catch {
    return LOCAL_DEV_CLERK_ID;
  }
}

async function requireSql(): Promise<Sql> {
  const sql = getSql();
  if (!sql) {
    throw new Error("Database is not configured: set DATABASE_URL_POOLED.");
  }
  return sql;
}

export async function ensureUserId(clerkId: string): Promise<string> {
  const sql = await requireSql();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.users (clerk_id)
    VALUES (${clerkId})
    ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
    RETURNING id
  `;
  return rows[0].id;
}

function titleFromMessages(messages: OreBaseUIMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser
    ? firstUser.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim()
    : "";
  if (!text) return "New chat";
  return text.length > MAX_CHAT_TITLE_LENGTH
    ? `${text.slice(0, MAX_CHAT_TITLE_LENGTH - 1)}…`
    : text;
}

function textFromMessage(message: OreBaseUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toUiMessage(row: StoredMessage): OreBaseUIMessage {
  const citations = Array.isArray(row.citations)
    ? (row.citations as Citation[])
    : undefined;
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: row.content ?? "" }],
    metadata: citations && citations.length > 0 ? { citations } : undefined,
  };
}

export async function listChats(): Promise<ChatSummary[]> {
  const sql = getSql();
  if (!sql) return [];

  try {
    const clerkId = await resolveClerkId();
    const rows = await sql<ChatSummary[]>`
      SELECT c.id, c.title, c.created_at
      FROM app.chats c
      INNER JOIN app.users u ON u.id = c.user_id
      WHERE u.clerk_id = ${clerkId}
      ORDER BY c.created_at DESC
      LIMIT ${CHAT_LIST_LIMIT}
    `;
    return [...rows];
  } catch {
    return [];
  }
}

export async function getChatMessages(chatId: string): Promise<OreBaseUIMessage[]> {
  if (!isDocumentUuid(chatId)) return [];
  const sql = getSql();
  if (!sql) return [];

  try {
    const clerkId = await resolveClerkId();
    const rows = await sql<StoredMessage[]>`
      SELECT m.id, m.role, m.content, m.citations
      FROM app.chat_messages m
      INNER JOIN app.chats c ON c.id = m.chat_id
      INNER JOIN app.users u ON u.id = c.user_id
      WHERE m.chat_id = ${chatId}
        AND u.clerk_id = ${clerkId}
        AND m.role IN ('user', 'assistant')
      ORDER BY m.created_at ASC
    `;
    return rows.map(toUiMessage);
  } catch {
    return [];
  }
}

export async function persistChat(
  chatId: string,
  messages: OreBaseUIMessage[],
): Promise<void> {
  if (!isDocumentUuid(chatId)) {
    throw new Error("chat id must be a UUID.");
  }

  const sql = await requireSql();
  const clerkId = await resolveClerkId();
  const userId = await ensureUserId(clerkId);
  const title = titleFromMessages(messages);

  await sql.begin(async (tx) => {
    const upserted = await tx<{ id: string }[]>`
      INSERT INTO app.chats (id, user_id, title)
      VALUES (${chatId}, ${userId}, ${title})
      ON CONFLICT (id) DO UPDATE
        SET title = COALESCE(app.chats.title, EXCLUDED.title)
      WHERE app.chats.user_id = ${userId}
      RETURNING id
    `;
    if (upserted.length === 0) {
      throw new Error("Chat does not belong to the current user.");
    }

    await tx`DELETE FROM app.chat_messages WHERE chat_id = ${chatId}`;

    for (const message of messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const content = textFromMessage(message);
      const citations =
        message.metadata?.citations ??
        (message.role === "assistant" ? collectCitations([message]) : []);
      await tx`
        INSERT INTO app.chat_messages (chat_id, role, content, citations)
        VALUES (
          ${chatId},
          ${message.role},
          ${content},
          ${tx.json(citations)}
        )
      `;
    }
  });
}
