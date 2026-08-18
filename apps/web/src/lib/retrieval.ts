import "server-only";
import type { Sql } from "postgres";

export const VOYAGE_MODEL = "voyage-3";
export const VOYAGE_EMBEDDING_DIM = 1024;
const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

export const DEFAULT_TOP_K = 8;
// Pool of nearest candidates pulled from each retrieval arm before fusion.
const CANDIDATE_LIMIT = 40;
// Reciprocal-rank-fusion damping constant (standard default).
const RRF_K = 60;

export type RetrievedChunk = {
  document_id: string;
  page_start: number | null;
  page_end: number | null;
  content: string;
};

/**
 * Embeds a single query string with Voyage AI `voyage-3` (1024-dim).
 * Throws on missing key or non-2xx so the caller can return a clean error.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not configured.");
  }

  const res = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [query],
      input_type: "query",
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage embedding request failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    data?: { embedding?: number[] }[];
  };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("Voyage returned an empty embedding.");
  }
  return embedding;
}

/**
 * Hybrid retrieval over raw.document_chunks: pgvector cosine similarity fused
 * with Postgres full-text ranking via reciprocal rank fusion.
 */
export async function hybridRetrieve(
  sql: Sql,
  embedding: number[],
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  const rows = await sql<RetrievedChunk[]>`
    WITH params AS (
      SELECT
        ${vectorLiteral}::vector AS query_embedding,
        plainto_tsquery('english', ${query}) AS query_ts
    ),
    vector_hits AS (
      SELECT
        c.id,
        c.document_id,
        c.page_start,
        c.page_end,
        c.content,
        row_number() OVER (
          ORDER BY c.embedding <=> (SELECT query_embedding FROM params)
        ) AS rank
      FROM raw.document_chunks c
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> (SELECT query_embedding FROM params)
      LIMIT ${CANDIDATE_LIMIT}
    ),
    text_hits AS (
      SELECT
        c.id,
        c.document_id,
        c.page_start,
        c.page_end,
        c.content,
        row_number() OVER (
          ORDER BY ts_rank(
            to_tsvector('english', c.content),
            (SELECT query_ts FROM params)
          ) DESC
        ) AS rank
      FROM raw.document_chunks c
      WHERE to_tsvector('english', c.content) @@ (SELECT query_ts FROM params)
      ORDER BY ts_rank(
        to_tsvector('english', c.content),
        (SELECT query_ts FROM params)
      ) DESC
      LIMIT ${CANDIDATE_LIMIT}
    )
    SELECT
      COALESCE(v.document_id, t.document_id) AS document_id,
      COALESCE(v.page_start, t.page_start) AS page_start,
      COALESCE(v.page_end, t.page_end) AS page_end,
      COALESCE(v.content, t.content) AS content
    FROM vector_hits v
    FULL OUTER JOIN text_hits t ON v.id = t.id
    ORDER BY
      (
        COALESCE(1.0 / (${RRF_K} + v.rank), 0)
        + COALESCE(1.0 / (${RRF_K} + t.rank), 0)
      ) DESC
    LIMIT ${topK}
  `;

  return [...rows];
}
