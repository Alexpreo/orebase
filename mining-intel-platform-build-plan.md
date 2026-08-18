# Mining Intelligence Platform — Master Build Plan (Cursor Handoff)

Working name: **OreBase** (placeholder — rename anytime)

**Locked decisions (do not re-litigate in Cursor):**
- Stack: Next.js 15 on Vercel · managed Postgres + pgvector (Neon or RDS) · AWS S3 for documents · Clerk auth · Dockerized Python workers · Postgres-backed job queue · Claude for extraction & chat · Textract for OCR/hard tables
- Ingestion bot: always-on EC2 box (Docker Compose) + one Lambda webhook for SEDAR+ email alerts
- Backfill scope: **Canada + US (SEDAR+ & EDGAR), last 5 years (mid-2021 → present), all commodities**, technical-reports-first
- Product: all three use cases (screener/deal flow, watchlist/competitor tracking, research/market) each get their own dashboard tab; none prioritized
- Data licensing product: parked. Nothing here blocks it later (all facts carry provenance), but don't build for it now.

---

## 1. What we're building and why it beats MineGPT

MineGPT's pitch: transform NI 43-101, SK-1300, and JORC technical reports into searchable mining intelligence with an AI chat layer. It's built on Lovable (a no-code app builder) — likely a thin "chat with documents" wrapper without deep structured extraction, a normalized database, or serious ingestion infrastructure.

**Our platform = three layers:**

1. **Ingestion engine** — continuously detects and pulls new filings, technical reports, and press releases from public disclosure systems into OUR OWN storage. We own the corpus forever. New projects and filings are detected automatically.
2. **Structured intelligence database** — every document is parsed and key facts extracted into normalized tables: companies, projects, resources/reserves (tonnage, grade, contained metal), drill intercepts, economics (NPV, IRR, capex, AISC), qualified persons, jurisdictions, commodities. Every fact carries provenance to its source document + page.
3. **AI chat + research UI** — RAG chat that answers with citations to the exact page of the source PDF, plus three dashboards, a project screener, watchlists, and alerts.

**Differentiators vs MineGPT:**
- We own the raw document corpus
- Structured, queryable data — you can screen ("all copper projects in BC with >0.4% Cu and a PEA since 2023"), not just chat
- Verifiable answers: every AI claim cites document + page with click-through PDF viewer
- Change detection: alerts the morning a company files a new 43-101, resource update, or drill results

## 2. Data sources

| Source | What it has | Access | Priority |
|---|---|---|---|
| **SEC EDGAR** (US) | SK-1300 technical report summaries, 10-K/10-Q, 8-K | Free official API + full-text search (`efts.sec.gov`, `data.sec.gov`) + current-filings feeds | **Build first** — zero friction |
| **SEDAR+** (Canada) | NI 43-101 technical reports, MD&A, material change reports, press releases for all TSX/TSXV miners | No API; browser UI with Radware bot protection. Full spec in §6 | **Core value** — build second |
| **Newswires** (GlobeNewswire, Newsfile, Accesswire) | Press releases, drill results | RSS feeds | Early — drill results hit here first |
| **ASX** (Australia) | JORC reports, quarterlies | Announcement pages per ticker | Phase 4+ |
| **Government geo surveys** (BC MinFile, USGS MRDS, etc.) | Structured deposit/occurrence data | Open data downloads | Enrichment (project lat/lng, commodities) |

## 3. Architecture & stack

```
┌────────────────────────────────────────────────────────────┐
│         INGESTION BOT — EC2 t3.medium, Docker Compose        │
│  edgar-poller (10–15 min) · newswire-poller (5–15 min)      │
│  sedar-incremental (2–3 scheduled runs/day + alert-driven)  │
│  processor (always-on, drains processing_jobs)              │
│  + Lambda webhook: SEDAR+ alert emails → pending_fetches    │
└──────────────┬─────────────────────────────────────────────┘
               ▼
     Raw PDFs → AWS S3 (versioning on)
     Metadata → Postgres `documents` (sha256-deduped)
               ▼
┌────────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE                       │
│  1. PDF → text/tables (PyMuPDF + pdfplumber;                │
│     Textract for scanned pages & hard tables)               │
│  2. Chunking (~800 tokens, page anchors, no mid-table cuts) │
│  3. Embeddings → pgvector (HNSW) + tsvector (hybrid search) │
│  4. Claude structured extraction → typed JSON →             │
│     normalized tables, with confidence scores               │
│  5. Low-confidence rows → admin review queue                │
└──────────────┬─────────────────────────────────────────────┘
               ▼
        Managed Postgres (Neon or RDS), three schemas:
        raw (documents/chunks) · core (companies/projects/…) ·
        app (users/chats/watchlists)
               ▼
┌────────────────────────────────────────────────────────────┐
│                 APP — Next.js 15 on Vercel                   │
│  RAG chat w/ citations · 3 dashboard tabs · screener        │
│  PDF viewer w/ page-jump (S3 presigned URLs) · admin        │
└────────────────────────────────────────────────────────────┘
```

### Stack details
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Vercel. Auth: Clerk (email + Google).
- **Database:** Postgres 16 + `pgvector`. One DB, three schemas. Plain SQL migrations (dbmate or atlas), no ORM lock-in. Not a separate vector DB — vectors next to relational data enables the hybrid vector+SQL retrieval that drives answer quality.
- **Storage:** S3, versioning on. The corpus is the crown-jewel asset. PDFs served to the app via presigned URLs.
- **Workers:** Python 3.12 (uv), Dockerized. Deps: httpx, pymupdf, pdfplumber, playwright, psycopg[binary], boto3, pydantic. Portable: same containers run on the EC2 box, Railway, or ECS Fargate.
- **Queue:** `processing_jobs` table claimed via `SELECT … FOR UPDATE SKIP LOCKED`. Industry standard at this scale; SQS/Temporal deferred (trigger: multi-team scale or >3–4 worker containers).
- **OCR/tables:** PyMuPDF/pdfplumber first; AWS Textract API per-page for scanned pages and gnarly resource/economics tables.
- **AI:** Embeddings via `voyage-3` (or OpenAI `text-embedding-3-large`). Extraction: Claude with JSON tool schemas; Batch API for backfills (50% cheaper). Chat: Claude streaming with retrieval + read-only SQL tools.
- **Monitoring:** Sentry + CloudWatch alarm on "no new `documents` rows in 24h per source" (silent-death detection) + admin ingestion dashboard (docs/day per source, failure counts, queue depth).
- **Never at this size:** Kubernetes, Cognito, microservices.

## 4. Database schema

```sql
-- ============ RAW LAYER ============
documents (
  id uuid pk, source text,              -- 'edgar' | 'sedar' | 'asx' | 'newswire' | 'manual'
  source_url text, external_id text,
  company_id uuid fk, project_id uuid fk null,
  doc_type text,                        -- 'ni43101' | 'sk1300' | 'jorc' | 'pea' | 'pfs' | 'fs'
                                        -- | 'press_release' | 'mda' | 'financials' | 'presentation'
  title text, filed_at date, sha256 text unique,   -- dedupe on hash
  storage_path text, page_count int,
  status text default 'ingested',       -- ingested → parsed → indexed → extracted | failed
  created_at timestamptz
)

document_chunks (
  id uuid pk, document_id uuid fk,
  chunk_index int, page_start int, page_end int,
  content text, section_title text null,
  embedding vector(1024)                -- HNSW index; plus tsvector GIN index on content
)

processing_jobs (
  id uuid pk, document_id uuid fk, job_type text,   -- parse | chunk | embed | extract
  status text, attempts int, last_error text, created_at, updated_at
)

-- ============ SEDAR+ INGESTION LAYER ============
sedar_issuers (
  id uuid pk, profile_number text unique, name text,
  jurisdiction text, industry text null,
  company_id uuid fk null,              -- link into core.companies
  active boolean, last_synced_at timestamptz
)

pending_fetches (
  id uuid pk, source text default 'sedar',
  issuer_profile text, document_type text, filed_date date,
  external_ref text,                    -- doc GUID/URL from alert or search
  discovered_via text,                  -- 'email_alert' | 'nightly_search' | 'backfill'
  status text default 'pending',        -- pending | fetched | failed | skipped_dupe
  attempts int default 0, last_error text, created_at timestamptz
)

scrape_runs (
  id uuid pk, mode text,                -- backfill | incremental
  slice text null,                      -- e.g. 'ni43101_2024_2026'
  started_at, finished_at, docs_found int, docs_fetched int,
  challenges_hit int, notes text
)

-- ============ CORE INTELLIGENCE LAYER ============
companies (
  id uuid pk, name text, tickers jsonb,             -- [{exchange:'TSXV', symbol:'ABC'}]
  hq_country text, website text, cik text null, sedar_profile text null
)

projects (
  id uuid pk, company_id uuid fk, name text,
  country text, region text, lat numeric null, lng numeric null,
  commodities text[],                               -- ['Cu','Au','Mo']
  stage text,           -- grassroots | exploration | resource | pea | pfs | fs
                        -- | permitting | construction | production | care_maintenance
  ownership_notes text, created_at, updated_at
)

resource_estimates (
  id uuid pk, project_id uuid fk, document_id uuid fk,   -- provenance!
  effective_date date, category text,     -- measured | indicated | inferred | proven | probable
  tonnes numeric, grade jsonb,            -- {"Cu_pct":0.45,"Au_gpt":0.31}
  contained_metal jsonb,                  -- {"Cu_lb":1.2e9,"Au_oz":450000}
  cutoff text null, standard text,        -- 'NI43-101' | 'SK-1300' | 'JORC'
  extraction_confidence numeric, reviewed boolean default false
)

drill_results (
  id uuid pk, project_id uuid fk, document_id uuid fk,
  hole_id text, announced_date date,
  from_m numeric, to_m numeric, interval_m numeric,
  assays jsonb, true_width_noted boolean null, extraction_confidence numeric
)

project_economics (
  id uuid pk, project_id uuid fk, document_id uuid fk,
  study_type text,                        -- pea | pfs | fs
  effective_date date, currency text,
  npv jsonb,                              -- {"post_tax_5pct":512000000}
  irr_pct numeric, capex_initial numeric, aisc jsonb,
  mine_life_years numeric, payback_years numeric,
  metal_price_assumptions jsonb, extraction_confidence numeric
)

qualified_persons (id uuid pk, name text, designation text, firm text null)
document_qps (document_id fk, qp_id fk, role text)

project_events (
  id uuid pk, project_id fk, document_id fk null,
  event_type text,      -- new_report | resource_update | drill_results | permit
                        -- | financing | ownership_change
  event_date date, summary text
)

-- ============ APP LAYER ============
users (Clerk-synced), chats (id, user_id, title, created_at),
chat_messages (id, chat_id, role, content, citations jsonb),
watchlists (id, user_id, name), watchlist_items (project_id | company_id),
alerts (id, user_id, criteria jsonb, channel text)
```

Design rules:
- **Every extracted fact carries `document_id` provenance** — this is what makes answers trustworthy.
- **`extraction_confidence` + `reviewed`** — LLM table extraction will make mistakes; the admin review queue exists from day one.
- **Dedupe on sha256** — dual-listed companies file the same PDF to SEDAR+ and EDGAR.
- **Everything idempotent** — pollers can crash and rerun without duplicates (external_id + sha256).

## 5. Processing pipeline

### 5.1 Parse
- PyMuPDF (`fitz`) for text + layout; pdfplumber for tables.
- Detect scanned/low-text pages → route through AWS Textract API (materially better than Tesseract on mining-report tables).
- Store per-page text with page numbers preserved — page anchors power citations.

### 5.2 Chunk + embed
- ~800-token chunks, 100 overlap, never split mid-table; attach `page_start/page_end` and nearest section heading. Exploit the standard 43-101 section structure (Item 1 Summary … Item 14 Mineral Resource Estimates … Item 21/22 Capital & Operating Costs / Economic Analysis).
- Embed → pgvector HNSW + tsvector full-text. **Hybrid retrieval (vector + keyword + recency boost) beats vector-only on technical numbers/codes.**

### 5.3 Structured extraction
- Per doc type, run Claude with a JSON tool schema (one schema per target table).
- Never send whole 400-page PDFs: use the section map to send only relevant sections (Item 14 → resource_estimates; Item 21/22 → project_economics).
- Post-validate with pydantic: units sane, grades within plausible ranges, tonnes > 0. Failures → review queue.
- Log token cost per doc. Batch API for backfills.
- Extraction can lag ingestion: parse/chunk/embed everything (cheap, chat works over full corpus), run structured extraction newest-first, extract older reports lazily.

### 5.4 RAG chat
Tools available to the chat model:
1. `search_documents(query, filters)` — hybrid retrieval over chunks, filterable by company/project/doc_type/date
2. `query_database(sql)` — read-only SQL over core schema through a whitelisted view ("rank BC copper projects by contained Cu")
3. `get_document(id, pages)` — pull specific pages for deep dives

System prompt rules: answer only from retrieved context; every claim cites `[doc_id p.X]`; say "not in the database" rather than guess. Frontend renders citations as chips → click opens pdf.js viewer at that page via S3 presigned URL. This retrieval+SQL tool pattern is the single biggest quality edge over "chat with PDF" competitors.

## 6. SEDAR+ ingestion (no API — full scraping spec)

### 6.1 Ground truth (as of mid-2026)
- **No official API.** Public search at sedarplus.ca is a JS SPA; results come from internal JSON services the browser calls.
- **Bot protection: Radware.** Plain httpx calls to internal endpoints get challenged. A real Playwright browser context passes most of the time; occasional challenges need manual solving.
- **PDFs download without CAPTCHA** once you have a valid browser session.
- **Reporting Issuers List is exportable** — our company universe seed.
- **Email alerts exist** for new disclosure documents — legitimate push channel for change detection.
- **Coverage:** everything filed since Jan 1, 2015; older via archive report option.
- **Terms of Use apply** — strategy below is deliberately low-volume and polite (see §10 legal).

### 6.2 Strategy: hybrid "browser-session harvester" + alert-driven incremental

**Mode A — Backfill (bounded project):** Playwright drives the real search UI filtered to document type + date range, paginates, extracts filing metadata, downloads PDFs. Runs in slices over weeks, human-in-the-loop for occasional challenges.

**Mode B — Incremental (tiny steady state):**
1. Subscribe to SEDAR+ email alerts for target document types → dedicated inbox via inbound-email service (Resend/Postmark webhook)
2. Lambda webhook parses alert emails → `pending_fetches` rows
3. Scheduled Playwright runs (2–3×/day) fetch only those specific documents
4. Nightly sweep: one small search for "filed yesterday" per target doc type catches anything alerts missed

**Key design decision: backfill is bounded; steady-state is alert-driven and tiny (5–50 docs/day). We almost never hammer their search.**

### 6.3 Discovery step (manual, ~1 hour, DO THIS FIRST)
Open sedarplus.ca with Chrome DevTools → Network tab and document in `workers/sedar/NOTES.md`:
1. The JSON request fired on document search (URL, method, payload shape, headers/tokens)
2. Response shape (issuer name, profile ID, doc type, filing date, document GUID/URL)
3. PDF download URL pattern
4. Pagination mechanics
5. Reporting Issuers List export format

Two implementation paths:
- **Path 1 (preferred):** replay the internal JSON calls *inside* the browser context via `page.request` — cookies/anti-bot tokens attach automatically, structured JSON back, no DOM parsing.
- **Path 2 (fallback):** classic UI automation — fill form, click, scrape results table.
Build Path 1 with automatic fallback to Path 2 when challenges start.

### 6.4 Module layout
```
workers/sedar/
  NOTES.md               # endpoint discovery findings
  session.py             # Playwright session: persistent profile, challenge
                         #   detection, headful takeover hook
  issuers.py             # Reporting Issuers List → sedar_issuers
  search.py              # JsonSearch (Path 1) + DomSearch (Path 2 fallback)
  backfill.py            # sliced historical harvest, checkpointed
  alerts_ingester.py     # inbound-email webhook → pending_fetches
  fetch_documents.py     # drain pending_fetches at polite rate
  ratelimit.py           # token bucket + jitter + circuit breaker
  config.py              # document types, slices, limits
```

### 6.5 Session & anti-bot handling
- Playwright Chromium, **persistent user-data dir** (`~/.sedar_profile` on the EC2 box's EBS volume — cookies/solved-challenge state survive between runs)
- Realistic context: normal viewport, en-CA locale, America/Vancouver timezone, default Chrome UA (no fake exotic UA)
- **Challenge detector:** after each nav/request, check for Radware markers (challenge DOM, 403s, HTML where JSON expected) → raise `ChallengeDetected`:
  - Incremental mode: pause queue, notify, expose `--headful` takeover (SSH port-forward/VNC) so you solve manually; profile persists the solve
  - Backfill mode: circuit breaker — 3 challenges in a run → stop, log to `scrape_runs`, resume next day
- **Rate limits:** 1 request per 4–8s with jitter; max ~200 docs/day in backfill; 60–120s pause between result pages; never sustained 24/7
- **One session, no proxy rotation, no fingerprint spoofing.** That's the line between polite automation of public filings and behavior that creates real problems. If polite automation can't keep up, the escalation is a licensed data redistributor, not stealth tooling.
- Back off during SEDAR+ maintenance windows (nights/weekends ET); detect maintenance pages.

### 6.6 Backfill slices (confirmed scope: Canada + US, mid-2021 → present, all commodities)
1. `issuers.py`: export Reporting Issuers List → `sedar_issuers`; flag mining issuers (TSX/TSXV mining sector lists + keyword match + dad's watchlist); fuzzy-link to `core.companies` with manual-confirm report for ambiguous matches.
2. Slices, by value density, newest first:
   - **Slice 1:** NI 43-101 Technical Reports, all mining issuers, 2024–2026 (screener becomes useful within ~2 weeks)
   - **Slice 2:** NI 43-101 Technical Reports, 2021–2023 (completes the 5-year core)
   - **Slice 3:** Material change reports + news releases, watchlist companies, last 2 years
   - **Slice 4:** MD&A/AIFs for watchlist; broader press releases via incremental only (historical PR firehose = huge volume, low extraction value; good drill results get consolidated into later technical reports anyway)
3. EDGAR runs in parallel with no rate anxiety: **all SK-1300 technical report summaries since 2021 — the rule took effect then, so this is the complete US set.**
4. Checkpointing: every fetched doc advances the slice cursor (issuer + date) in `scrape_runs`; killed runs resume exactly.

Volume estimate: SEDAR+ files roughly 800–1,200 technical reports/year → 5-year core ≈ 4,000–6,000 reports ≈ 1–1.5 months at polite pace. Pipeline processes continuously as docs land; value compounds daily.

### 6.7 Failure modes
| Failure | Detection | Response |
|---|---|---|
| Radware challenge | challenge detector | pause, notify, manual solve, resume |
| UI/endpoint change (SEDAR+ ships quarterly updates) | Path 1 schema mismatch / Path 2 selector miss | alert; auto-fallback to other path; update NOTES.md |
| Silent partial results | `docs_found` >40% below trailing average | alert |
| Duplicate floods | sha256 dedupe | `skipped_dupe`, no reprocessing |
| Maintenance window | maintenance-page detection | back off, retry next window |
| Bot silently dead | CloudWatch: no new `documents` in 24h per source | alarm |

## 7. App: dashboards & features

All three use cases get their own top-level tab; all are views over the same core tables — build the data layer once, compose tabs from shared components (project card, resource table, economics table, event feed item, mini-map).

1. **Screener / Deal Flow** — saved filter sets ("BC Cu >0.4%, PEA+ stage"), sortable comparison table, map view, CSV export. Backed by `projects` + `resource_estimates` + `project_economics`.
2. **Watchlist / Competitor Tracking** — selected companies/projects; activity feed from `project_events` (new filings, drill results, resource updates), per-company timelines, new-since-last-visit markers, alert toggles.
3. **Research / Market** — recent-filings firehose with filters, cross-industry drill-result highlights, aggregates (filings per commodity/jurisdiction over time, stage distribution, active QPs), quick-launch into chat with document context pre-loaded.

Plus: company & project profile pages (overview, latest resource, economics, event timeline, documents), admin (ingestion stats, review queue, retry controls), chat with citations everywhere.

## 8. Deployment: the always-on ingestion bot (AWS)

**EC2 t3.medium (~$30–45/mo) running Docker Compose**, four containers:
1. `edgar-poller` — EDGAR current-filings feeds every 10–15 min for SIC 1000–1099 filers (EDGAR is built for polling; stay within their fair-access rules: ≤10 req/s, declared User-Agent with contact email)
2. `newswire-poller` — RSS every 5–15 min (drill results often hit newswires hours before filing systems)
3. `sedar-incremental` — scheduled 2–3×/day + alert-driven; persistent Playwright profile on EBS; headful takeover over SSH when challenged. This is why EC2 beats Lambda here: persistent browser state + occasional manual intervention is server work.
4. `processor` — always-on, drains `processing_jobs`

**Plus:** API Gateway + Lambda receiving the SEDAR+ alert-email webhook → `pending_fetches` (serverless so alert capture survives even if the box dies).

**Flow, zero humans:** detect → download → S3 → `documents` (dedupe) → `processing_jobs` → parse/chunk/embed/extract → `project_events` → watchlist match → email/Slack alert → Watchlist feed + instantly queryable in chat.

**Ops:**
- `restart: always` in compose; secrets in SSM Parameter Store, not .env on the box
- CloudWatch alarm: "no new `documents` rows in 24h per source" — bots fail silently (quarterly SEDAR+ UI update breaks a selector while the bot runs happily ingesting nothing); silent-death detection matters more than uptime nines
- Containers are portable: same compose runs on Railway/Fly if you ever want off EC2

## 9. Phased build plan

### Phase 0 — Foundation (1–2 days)
- Monorepo: `apps/web` (Next.js 15 + TS + Tailwind + shadcn/ui, Vercel) + `workers/` (Python 3.12, Dockerized) + `infra/` (Terraform stub: S3 bucket versioned + scoped IAM; compose file for the EC2 box)
- Managed Postgres + pgvector; all §4 schemas as plain SQL migrations (dbmate); HNSW + tsvector GIN indexes
- Clerk auth (email + Google); app shell with sidebar: Chat, Screener, Watchlist, Research, Companies, Documents, Admin

### Phase 1 — EDGAR ingestion MVP (3–5 days)
- `edgar_poller.py` + `processor.py` (parse → chunk → embed) working end-to-end
- Admin documents table: status, retry, per-source stats
- **Milestone: ask a question in a bare chat UI, get a cited answer from a real filed document**

### Phase 2 — Chat with citations (3–4 days)
- Streaming chat (Vercel AI SDK) with the 3 tools from §5.4
- Citation chips + pdf.js viewer with page jump; chat history persisted; filter panel

### Phase 3 — Structured extraction + product surface (5–7 days)
- `extractor.py` for resources, economics, drill results, QPs; pydantic validation; confidence scores
- Admin review queue (approve/edit/reject)
- Company/project profile pages; the three dashboard tabs (§7) from shared components

### Phase 4 — SEDAR+ + newswires + alerts (parallel/ongoing)
- SEDAR+ discovery hour → session → issuers → **incremental pipeline FIRST** (start capturing new filings immediately) → backfill Slice 1 → expand slices
- Newswire RSS pollers; new-filing detection → `project_events` → user email alerts
- Deploy the EC2 bot (§8); map view of projects (MinFile/USGS enrichment)

### Phase 5 — Productize (later, descoped)
- Orgs/teams, Stripe if it goes beyond internal use. Licensing intentionally parked; provenance already in place if revived.

## 10. Legal & compliance notes

- **EDGAR:** explicitly free/public with official API. Follow fair-access rules. Safest source.
- **SEDAR+:** documents are public disclosure, but the site has Terms of Use + anti-automation. The polite, low-volume, alert-driven strategy in §6 is designed around that. Read the ToU before scaling backfill; a one-hour lawyer conversation is cheap insurance.
- **Documents vs facts:** extracted facts (tonnage, grades, NPV) are data. Redistributing full PDF copies to third parties is murkier (reports are authored works even when publicly filed) — irrelevant while internal, relevant if productized later.
- **Disclaimers:** chat output carries "not investment advice" language; citations everywhere reinforce intelligence-tool positioning.
- Not legal advice — issues to raise with a lawyer, not conclusions.

## 11. Cost estimate (MVP scale, monthly)

| Item | Monthly |
|---|---|
| Managed Postgres (Neon Launch / small RDS) | $20–60 |
| S3 (corpus + requests) | $5–20 |
| EC2 t3.medium ingestion bot | $30–45 |
| Vercel Pro | $20 |
| Clerk | free → $25 |
| Textract (scanned pages + hard tables only) | $10–50 during backfill |
| Embeddings (backfill amortized) | $20–100 |
| Claude extraction (~$0.50–3/large report w/ section targeting + Batch API) | $100–500 during backfill; the full 5-yr technical-report core is roughly $2k–15k one-time depending on aggressiveness — mitigate by extracting newest-first, lazily for older docs |
| Chat inference | usage-based; meter from day one |

## 12. Order of operations (first weeks)

1. ✅ DECIDED: three dashboard tabs; backfill = Canada + US, 5 years, all commodities, technical-reports-first
2. Phase 0 in Cursor (prompt below)
3. Phase 1: EDGAR poller on 20–50 known companies; one document flowing end-to-end ingest → parse → chunk → embed → **cited chat answer** (demo this to your dad — the moment it becomes real)
4. Phase 2 chat, Phase 3 extraction + dashboards
5. SEDAR+ DevTools discovery hour → NOTES.md → session.py → issuers → incremental BEFORE backfill → Slice 1
6. Deploy EC2 bot; turn on CloudWatch silent-death alarm

## 13. Cursor kickoff prompts (copy-paste per phase)

**Phase 0:**
> Set up a monorepo: `apps/web` = Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, Clerk auth (email+Google). `workers/` = Python 3.12 managed with uv, Dockerfile included, deps: httpx, pymupdf, pdfplumber, playwright, psycopg[binary], boto3, pydantic. `infra/` = Terraform stub for an S3 bucket (versioning enabled) + IAM user scoped to it, plus a docker-compose.yml for the worker fleet. Database is managed Postgres with pgvector: write plain SQL migrations (dbmate) for these tables: [paste §4 schema], with an HNSW index on document_chunks.embedding and a tsvector GIN index on content. Build an app shell with sidebar nav: Chat, Screener, Watchlist, Research, Companies, Documents, Admin.

**Phase 1:**
> In `workers/`, build `edgar_poller.py`: query SEC EDGAR full-text search (efts.sec.gov) for technical report summaries and filings from SIC 1000–1099 companies, respect SEC rate limits (10 req/s max, proper User-Agent header with contact email), download PDFs/exhibits, compute sha256, skip duplicates, upload to S3 via boto3, insert into `documents`, and enqueue a `parse` job in `processing_jobs`. Then build `processor.py`: a loop that claims jobs (SELECT ... FOR UPDATE SKIP LOCKED), runs parse → chunk (~800 tokens, page anchors, no mid-table splits) → embed (voyage-3) → writes `document_chunks`, advancing document status. Detect scanned/low-text pages and route them through the AWS Textract API before chunking. Add retry with exponential backoff and `last_error` capture.

**Phase 2:**
> In `apps/web`, build a streaming chat at `/chat` using the Vercel AI SDK and Claude, with three tools: `search_documents` (hybrid pgvector + full-text query over document_chunks with metadata filters), `query_database` (read-only SQL against the core schema through a whitelisted view), and `get_document`. System prompt: only answer from retrieved context, cite every claim as [docId p.X], say when info isn't in the database. Render citations as clickable chips opening a pdf.js viewer at the cited page (S3 presigned URLs). Persist chats/messages to Postgres.

**Phase 3:**
> Build `extractor.py`: for documents with status='indexed', map the 43-101/SK-1300 section structure, send relevant sections to Claude with JSON tool schemas for resource_estimates, project_economics, drill_results, and qualified_persons; validate with pydantic (unit sanity checks: plausible grades, tonnes > 0), write rows with extraction_confidence, flag low-confidence rows. In `apps/web`, build `/admin/review` (approve/edit/reject extracted rows), `/projects/[id]` profile pages, and the three dashboard tabs — Screener (saved filters, comparison table, map, CSV export), Watchlist (activity feed from project_events, per-company timelines, alert toggles), Research (recent-filings feed, drill-result highlights, aggregate charts) — composed from shared components: project card, resource table, economics table, event feed item, mini-map.

**Phase 4a — SEDAR+ session + discovery harness:**
> In `workers/sedar/`, build `session.py`: a Playwright (Python, sync API) manager that launches Chromium with a persistent user-data directory at `~/.sedar_profile`, en-CA locale, America/Vancouver timezone, and exposes `get_page()`. Add `detect_challenge(page)` that flags Radware bot-challenge pages (unexpected HTML on JSON routes, 403s, challenge DOM markers) and raises `ChallengeDetected`. Add a `--headful` CLI flag so I can watch and manually solve challenges; the persistent profile must retain solved state. Include `ratelimit.py` with a token bucket (1 req / 4–8s jittered) and a circuit breaker aborting a run after 3 challenges.

**Phase 4b — issuer universe:**
> Build `issuers.py`: using the Playwright session, download the SEDAR+ Reporting Issuers List export, parse it, upsert into `sedar_issuers` (profile_number unique). Add `--mark-mining` flagging issuers matching a provided ticker/name watchlist CSV plus common mining keywords. Fuzzy-link matched issuers to `core.companies` with a manual-confirm report for ambiguous matches.

**Phase 4c — incremental (build BEFORE backfill):**
> Build `alerts_ingester.py`: a webhook endpoint (FastAPI, deployable as Lambda) receiving inbound-email JSON from Resend, parsing SEDAR+ alert emails into `pending_fetches` rows. Build `fetch_documents.py`: process pending rows at the polite rate through the Playwright session, with attempts/last_error tracking. Add a nightly job that searches yesterday's filings for our target document types and enqueues anything not already in `documents` or `pending_fetches`.

**Phase 4d — search + backfill:**
> Build `search.py` with two strategies: (1) `JsonSearch` — replay the internal document-search JSON request from within the browser context via `page.request.post`, using the request shape documented in `NOTES.md`, returning typed `FilingResult` objects; (2) `DomSearch` fallback driving the search form UI and scraping the results table. Then `backfill.py`: iterate config-defined slices (document type + date range + issuer set — Slice 1 is NI 43-101 Technical Reports 2024–2026, all mining issuers), paginate politely, checkpoint progress per slice in `scrape_runs`, download each PDF, sha256-dedupe, upload to S3, insert into `documents` with source='sedar', enqueue parse jobs. Resume from checkpoint on restart.

**Phase 4e — deployment:**
> Write the production docker-compose.yml for an EC2 t3.medium: services edgar-poller (15-min loop), newswire-poller (10-min RSS loop), sedar-incremental (cron-style scheduler, 3 runs/day + pending_fetches drain), and processor (always-on), all restart: always, secrets pulled from AWS SSM Parameter Store at startup, logs to CloudWatch. Add a CloudWatch metric + alarm: no new `documents` rows in 24h for any active source. Include a Makefile with deploy/ssh/logs targets and a short RUNBOOK.md covering the headful challenge-solve procedure over SSH port-forwarding.
