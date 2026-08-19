import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { isDocumentUuid } from "@/lib/citations";
import { getSql } from "@/lib/db";
import {
  DEFAULT_TOP_K,
  VOYAGE_EMBEDDING_DIM,
  embedQuery,
  hybridRetrieve,
} from "@/lib/retrieval";

const GET_DOCUMENT_MAX_CHUNKS = 20;
const MAX_SQL_ROWS = 50;
const DISALLOWED_SQL =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|execute|call|do\s|set\b|reset|listen|notify|lock|vacuum|analyze|comment|security|pg_sleep|dblink|information_schema|pg_catalog)\b/i;

type DocumentPageChunk = {
  document_id: string;
  page_start: number | null;
  page_end: number | null;
  chunk_index: number;
  content: string;
  title: string | null;
};

function assertReadOnlySelect(sqlText: string): string {
  const trimmed = sqlText.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) {
    throw new Error("Only a single SELECT statement is allowed.");
  }
  if (!/^\s*(with\b[\s\S]+)?select\b/i.test(trimmed)) {
    throw new Error("Only SELECT queries are allowed.");
  }
  if (DISALLOWED_SQL.test(trimmed)) {
    throw new Error("Query contains a disallowed keyword.");
  }
  return trimmed;
}

export const searchDocumentsTool = tool({
  description:
    "Hybrid search over indexed technical-report chunks. Use this first for any factual question. Filter by company name, document type, or filing date when the user specifies them.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query in natural language or keywords."),
    company: z
      .string()
      .optional()
      .describe("Company name, ticker, or CIK fragment to filter filings."),
    doc_type: z
      .string()
      .optional()
      .describe("Document type such as sk1300, ni43101, financials, press_release."),
    date_from: z.string().optional().describe("Inclusive filing date lower bound, YYYY-MM-DD."),
    date_to: z.string().optional().describe("Inclusive filing date upper bound, YYYY-MM-DD."),
  }),
  execute: async ({ query, company, doc_type, date_from, date_to }) => {
    const sql = getSql();
    if (!sql) {
      return { error: "Database is not configured.", chunks: [] };
    }
    let embedding: number[];
    try {
      embedding = await embedQuery(query);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Embedding request failed.",
        chunks: [],
      };
    }
    const chunks = await hybridRetrieve(sql, embedding, query, DEFAULT_TOP_K, {
      company,
      docType: doc_type,
      dateFrom: date_from,
      dateTo: date_to,
    });

    if (process.env.NODE_ENV !== "production") {
      console.debug("[chat] search_documents", {
        queryLength: query.length,
        embeddingDims: embedding.length,
        expectedDims: VOYAGE_EMBEDDING_DIM,
        topK: DEFAULT_TOP_K,
        totalChunks: chunks.length,
        company: company ?? null,
        docType: doc_type ?? null,
        dateFrom: date_from ?? null,
        dateTo: date_to ?? null,
      });
    }

    return { chunks };
  },
});

export const getDocumentTool = tool({
  description:
    "Load page-bounded text from a specific indexed document. Use after search_documents when you need more of a cited filing.",
  inputSchema: z.object({
    document_id: z.string().uuid().describe("Document UUID from search_documents."),
    page_start: z.number().int().positive().optional().describe("First page to include."),
    page_end: z.number().int().positive().optional().describe("Last page to include."),
  }),
  execute: async ({ document_id, page_start, page_end }) => {
    if (!isDocumentUuid(document_id)) {
      return { error: "document_id must be a UUID.", chunks: [] };
    }
    const sql = getSql();
    if (!sql) {
      return { error: "Database is not configured.", chunks: [] };
    }

    const pageStart = page_start ?? null;
    const pageEnd = page_end ?? null;

    const rows = await sql<DocumentPageChunk[]>`
      SELECT
        c.document_id,
        c.page_start,
        c.page_end,
        c.chunk_index,
        c.content,
        d.title
      FROM raw.document_chunks c
      INNER JOIN raw.documents d ON d.id = c.document_id
      WHERE c.document_id = ${document_id}
        AND (${pageStart}::int IS NULL OR COALESCE(c.page_end, c.page_start) >= ${pageStart})
        AND (${pageEnd}::int IS NULL OR COALESCE(c.page_start, c.page_end) <= ${pageEnd})
      ORDER BY c.chunk_index
      LIMIT ${GET_DOCUMENT_MAX_CHUNKS}
    `;

    if (process.env.NODE_ENV !== "production") {
      console.debug("[chat] get_document", {
        documentId: document_id,
        pageStart: page_start ?? null,
        pageEnd: page_end ?? null,
        totalChunks: rows.length,
      });
    }

    if (rows.length === 0) {
      return {
        document_id,
        error: "That document is not in the database, or those pages are not indexed.",
        chunks: [],
      };
    }

    return {
      document_id,
      title: rows[0].title,
      chunks: rows,
    };
  },
});

export const queryDatabaseTool = tool({
  description:
    "Run a read-only SQL SELECT against structured core views (core.v_companies, core.v_projects, core.v_resource_estimates, core.v_drill_results, core.v_project_economics, core.v_qualified_persons, core.v_document_qps, core.v_project_events). These tables are empty until structured extraction runs. Prefer search_documents for filing questions.",
  inputSchema: z.object({
    sql: z
      .string()
      .min(1)
      .describe("A single SELECT (or WITH ... SELECT) against core.v_* views only."),
  }),
  execute: async ({ sql: sqlText }) => {
    const sql = getSql();
    if (!sql) {
      return { error: "Database is not configured.", rows: [], rowCount: 0 };
    }

    let safeSql: string;
    try {
      safeSql = assertReadOnlySelect(sqlText);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid SQL.",
        rows: [],
        rowCount: 0,
      };
    }

    const wrapped = `SELECT * FROM (${safeSql}) AS orebase_query LIMIT ${MAX_SQL_ROWS}`;

    try {
      const rows = await sql.begin(async (tx) => {
        await tx`SET TRANSACTION READ ONLY`;
        await tx.unsafe("SET LOCAL ROLE orebase_chat");
        await tx.unsafe("SET LOCAL statement_timeout = '5s'");
        return tx.unsafe(wrapped);
      });

      const list = Array.isArray(rows) ? rows : [];
      if (process.env.NODE_ENV !== "production") {
        console.debug("[chat] query_database", {
          sqlLength: safeSql.length,
          rowCount: list.length,
        });
      }

      return {
        rows: list,
        rowCount: list.length,
        emptyReason:
          list.length === 0
            ? "No matching rows. Structured extraction has not populated these tables yet."
            : undefined,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Query failed.",
        rows: [],
        rowCount: 0,
      };
    }
  },
});
