# OreBase — Mining Intelligence Platform

Ingestion engine + structured intelligence database + AI chat/research UI for mining technical reports (NI 43-101, SK-1300, JORC).

Source of truth for scope and architecture: [mining-intel-platform-build-plan.md](mining-intel-platform-build-plan.md).

This repo currently implements **Phase 0 (foundation)**, **Phase 1 (EDGAR ingestion MVP)**, and **Phase 2 (cited streaming chat)**. Screener, watchlist, research, and company profiles wait on structured extraction (Phase 3).

## Monorepo layout

```
apps/web/      Next.js 16 (App Router, TS, Tailwind, shadcn/ui, Clerk auth)
workers/       Python 3.12 (uv) — edgar_poller, processor, common helpers
db/            dbmate SQL migrations (schemas: raw, core, app, sedar)
infra/         Terraform stub (versioned S3 + scoped IAM), docker-compose stub
```

## Stack

- **Frontend:** Next.js 16, TypeScript, Tailwind, shadcn/ui, Clerk (email + Google), Vercel
- **Database:** Neon Postgres 16 + pgvector (HNSW + tsvector hybrid retrieval), migrations via dbmate
- **Storage:** AWS S3 (versioning on) for the raw PDF corpus
- **Workers:** Python 3.12 (uv), Dockerized — httpx, pymupdf, pdfplumber, playwright, psycopg, boto3, pydantic
- **AI:** `voyage-4` embeddings (1024-dim), Claude for chat + extraction, AWS Textract for scanned pages

## Prerequisites

Toolchain (installed during setup): Node 18+, `pnpm`, Python 3.12, `uv`, `dbmate`.
Accounts/keys required (see each package's `.env.example`): Neon, AWS (S3 + Textract), Clerk, Anthropic, Voyage AI.

## Getting started

1. Copy each `.env.example` to `.env` and fill in real values (see the per-package files).
2. Web app: `cd apps/web && pnpm install && pnpm dev`
3. Database migrations: `cd db && dbmate up` (requires `DATABASE_URL`)
4. Workers: `cd workers && uv sync`, then `uv run python edgar_poller.py` / `uv run python processor.py`

Never commit `.env` files — they are gitignored.
