import "server-only";
import postgres, { type Sql } from "postgres";

const connectionString =
  process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;

// Cache the client across hot-reloads / lambda invocations without throwing at
// import time when no connection string is configured.
const globalForDb = globalThis as unknown as { __obSql?: Sql | null };

/**
 * Returns a shared postgres.js client, or `null` when no connection string is
 * configured. Callers must handle the null case and render an empty state.
 */
export function getSql(): Sql | null {
  if (globalForDb.__obSql !== undefined) {
    return globalForDb.__obSql;
  }

  if (!connectionString) {
    globalForDb.__obSql = null;
    return null;
  }

  const client = postgres(connectionString, {
    // Keep the serverless footprint small; Neon's pooler handles concurrency.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  globalForDb.__obSql = client;
  return client;
}

export function isDbConfigured(): boolean {
  return Boolean(connectionString);
}
