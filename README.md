# OreBase — Mining Intelligence Platform

Ingestion engine + structured intelligence database + AI chat/research UI for mining technical reports (NI 43-101, SK-1300, JORC).

Source of truth for scope and architecture: [mining-intel-platform-build-plan.md](mining-intel-platform-build-plan.md).

This repo currently implements **Phases 0–3** plus **Phase 4 incremental ingest** (SEDAR+ session, issuer load, alert webhook, nightly sweep, newswire RSS, email alerts, EC2 compose + silent-death alarm). Historical SEDAR/EDGAR backfill is gated and not started. The map still waits on MinFile/USGS.

## Monorepo layout

```
apps/web/      Next.js 16 (App Router, TS, Tailwind, shadcn/ui, Clerk auth)
workers/       Python 3.12 (uv) — edgar_poller, processor, extractor, sedar/, newswire_poller, alerts
db/            dbmate SQL migrations (schemas: raw, core, app, sedar)
infra/         Terraform (versioned S3, IAM, CloudWatch silent-death), docker-compose for EC2
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
4. Workers: `cd workers && uv sync`, then `uv run python edgar_poller.py` / `uv run python processor.py` / `uv run python extractor.py --once`
5. Canadian NI 43-101s: download the PDF in Chrome, then  
   `cd workers && uv run python -m sedar.ingest_local --file ~/Downloads/report.pdf --issuer "…" --filed-at YYYY-MM-DD`  
   (or upload on `/admin`). Automated SEDAR+ search is blocked until a headed session works; see `workers/sedar/NOTES.md`.
6. EC2 bot: see [infra/RUNBOOK.md](infra/RUNBOOK.md)

Production web **requires** Clerk keys. Historical backfill is `uv run python -m sedar.backfill --confirm-backfill --slice ni43101_2024_present` and is not run automatically.

Never commit `.env` files — they are gitignored.
