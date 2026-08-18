# OreBase database

Postgres 16 + [`pgvector`](https://github.com/pgvector/pgvector), one database with four schemas:

- `raw` — ingested documents, chunks, and the processing job queue
- `sedar` — SEDAR+ ingestion bookkeeping (issuers, pending fetches, scrape runs)
- `core` — normalized intelligence (companies, projects, resources, economics, drill results, QPs, events)
- `app` — product data (Clerk-synced users, chats, watchlists, alerts)

Migrations are plain SQL managed by [`dbmate`](https://github.com/amacneil/dbmate) — no ORM.

## Setup

1. Copy the env template and fill in your Neon connection string:

   ```bash
   cp .env.example .env
   ```

   `DATABASE_URL` must be the **direct / unpooled** Neon connection string (the host
   without `-pooler`). Migrations run DDL in transactions; the pooled PgBouncer endpoint
   does not support everything dbmate needs.

2. Apply migrations:

   ```bash
   dbmate up        # apply all pending migrations
   dbmate down      # roll back the most recent migration
   dbmate status    # show applied / pending migrations
   dbmate new name  # scaffold a new migration file
   ```

`dbmate` reads `.env` automatically. It also records applied migrations in a
`schema_migrations` table and writes a `schema.sql` snapshot after each run.

## pgvector / HNSW note

`20260715000001_extensions_and_schemas.sql` runs `CREATE EXTENSION IF NOT EXISTS vector;`.
The HNSW index (`20260715000006_indexes.sql`) requires **pgvector >= 0.5.0**. Neon ships a
recent pgvector, so no manual configuration is needed. If you point `DATABASE_URL` at a
self-hosted Postgres, ensure a recent pgvector is installed or the HNSW index creation
will fail.

Embeddings are `vector(1024)` to match Voyage `voyage-3` output. The index uses
`vector_cosine_ops`; query with the `<=>` cosine-distance operator.

## Migration order

| File | Contents |
|---|---|
| `..._extensions_and_schemas.sql` | `vector` + `pgcrypto` extensions, the four schemas |
| `..._raw_layer.sql` | `raw.documents`, `raw.document_chunks`, `raw.processing_jobs` |
| `..._sedar_layer.sql` | `sedar.sedar_issuers`, `sedar.pending_fetches`, `sedar.scrape_runs` |
| `..._core_layer.sql` | `core.*` tables + cross-schema FKs from `raw`/`sedar` into `core` |
| `..._app_layer.sql` | `app.*` tables |
| `..._indexes.sql` | HNSW vector index, tsvector GIN index, FK/lookup indexes |

`raw.documents.company_id` / `project_id` and `sedar.sedar_issuers.company_id` reference
`core.*`, which is created later, so those foreign keys are added via `ALTER TABLE` inside
the core migration to avoid an ordering cycle.
