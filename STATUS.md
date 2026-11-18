# OreBase status, 2026-11-18

Source plan: `mining-intel-platform-build-plan.md` (there is no PLAN.md). Read-only audit; no code changed.

## Bottom line
The Phase 1 milestone was reached in August 2026: real filings were ingested, parsed, chunked and embedded, and a chat
got a cited answer. Phases 0–3 are in the code and work. Phase 4 is partial: the code exists, but SEDAR+ cannot run
unattended and **ingestion stopped on 2026-08-25**. No new documents in about 12 weeks means the always-on bot is not running anywhere.

**Furthest point that works:** 51 filings (EDGAR, SEDAR via manual upload, newswire) are fully indexed and searchable in a cited chat.
9 of them have structured facts that feed the screener and profile pages. Nothing ingests new filings by itself today.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` (apps/web) | pass |
| `eslint src` | pass |
| `next build` | not run (writes `.next/`) |
| Worker imports (31 modules) | all OK |
| Migrations | 13/13 applied (latest `20260824000001`) |

### Live data (Neon, read-only queries)
| Table | Rows |
|---|---|
| documents | 51. edgar 19 (9 extracted, 10 indexed), sedar 29 indexed, newswire 3 indexed |
| doc types | ni43101 29, sk1300 19, press_release 3 |
| document_chunks | 7,087, all embedded, across 50 docs |
| processing_jobs | parse 51 done; extract 9 done, **42 pending**; 0 errors |
| core | companies 6, projects 8, resource_estimates 66 (26 reviewed, average confidence 0.51), drill_results 26, project_economics 2, QPs 8, project_events 14 |
| sedar | sedar_issuers 0, scrape_runs 0, pending_fetches 1 (failed, 2026-08-24) |
| app | users 1, chats 1, chat_messages 2 (last 2026-08-21), watchlists 1 (0 items), alerts 0 |
| extraction spend | $0.53 total, all in Aug 2026 (27 Haiku 4.5 calls, 17 Sonnet 4.5 calls) |
| Last document created | edgar and newswire 2026-08-25; sedar 2026-08-20 |

## Phase scorecard (plan §9)
| Phase | Status | Evidence |
|---|---|---|
| 0 Foundation | **Done** | Monorepo apps/web + workers + infra + db. All 34 tables from §4, HNSW and GIN tsvector indexes (`db/migrations/…000006_indexes.sql`). Clerk wired (`src/proxy.ts`). Sidebar shell. |
| 1 EDGAR MVP | **Done** | `edgar_poller.py` (EFTS EX-96, sha256 dedupe, S3) and `processor.py` (PyMuPDF/pdfplumber parse, about 800-token table-safe chunks, voyage-4) are complete. 7,087 embedded chunks. A chat exists with a cited answer. |
| 2 Chat + citations | **Done** | All 3 tools in `lib/chat-tools.ts`. `query_database` runs as the `orebase_chat` role over `core.v_*` views. Citation chips, pdf.js viewer with page jump, chats saved. |
| 3 Extraction + UI | **Done (mostly unrun)** | `extractor.py` does two-tier triage and Haiku/Sonnet calls with pydantic validation. Review queue, profile pages, screener, watchlist and research are all real (no placeholders). Only 9 of 51 docs extracted; 42 jobs are queued. |
| 4 SEDAR+, newswire, alerts, deploy | **Partial** | Newswire poller and email alerts are complete. SEDAR+ only works through manual PDF upload (`sedar.ingest_local`, `/admin`). Automated search is not working: NOTES.md has no JSON endpoint, DOM selectors are untested, and the Docker image has only Chromium, which SEDAR+ blocks with a 403. Terraform and compose are ready; the EC2 bot is not running (no docs since Aug 25). Geo loaders and map exist. |
| 5 Daily-use close | Code landed | Commit b044ef2. The operator step "headed Path 1 / alert → extract → watchlist email" is still open (`docs/phase-5-plan.md:20`). |

## Divergences from the plan (all appear intentional and documented in docs/)
- Next 16 instead of 15 (`middleware.ts` → `proxy.ts`). voyage-4 instead of voyage-3 (same 1024 dimensions).
- The SEDAR alert webhook is a Next route (`api/ingest/sedar-alert`), not a Lambda. `alerts_ingester.py` (FastAPI) is unused.
- Two-tier extraction: everything is triaged; full extraction runs only for documents under 18 months old or on a watchlist, otherwise on first view.
- The PDF viewer streams same-origin through `api/documents/[id]/file` instead of presigned URLs.
- Retrieval fuses vector and full-text results with RRF, but has **no recency boost** (§5.2 asks for one). This one doesn't look like a decision.
- Historical SEDAR backfill is opt-in only (`--confirm-backfill`).

## Uncommitted work (6 files under workers/)
- Complete and safe: a NUL-byte strip in `processor.py`, new newswire feed URLs, and a new SEDAR search entry URL.
- Half-verified:
  - `sedar/session.py` and `sedar/search.py` now use real Chrome plus Select2/jQuery form filling.
  - `_parse_filed` only accepts YYYY-MM-DD, while the form uses dd/mm/yyyy.
  - The wait on the hidden select may time out.
  - The profile directory moved to `~/.sedar_profile/chrome`, so challenges solved before have to be solved again.
  - NOTES.md is stale against these changes.

## Gaps and risks
1. **Ingestion is down.** Nothing has run since Aug 25, so the corpus is about 3 months stale.
2. **Extraction loses data during a Claude outage.** If Claude is unavailable at triage, the doc is set to `extracted` with zero facts and is never retried (`extractor.py:299-301, 399-464`).
3. **Admin bypass.** `isAdmin()` returns true when the Clerk key is missing, even in production (`lib/admin-auth.ts:17`). The SEDAR webhook also accepts anyone when its secret is empty (`alerts_ingester.py:41`).
4. **Processor retries:** a doc is marked `failed` while retries remain, and other workers can re-claim the job right away (`processor.py:392-403`).
5. **Embedding waste:** reprocessing re-embeds every chunk, with no content-hash reuse. The EDGAR poller re-downloads up to 50 known filings every 15 min (dedupe only happens after download).
6. **Retrieval scaling:** the `filtered_chunks` CTE is referenced twice, which likely materializes it and skips the HNSW and GIN indexes (`lib/retrieval.ts`). The company filter is a title `ILIKE`.
7. **OCR is off by default** (`OCR_BACKEND="none"`), so scanned pages yield no text.
8. **Infra:**
   - The IAM user has no `logs:*` permissions, but the prod compose uses awslogs.
   - `core.v_project_events` lacks `created_at`.
   - One down-migration drops indexes without a schema prefix.
9. **Alert duplicates:** `alerts.py` sends one email per alert row × watchlist for the same event.
10. **Placeholder EDGAR User-Agent** (`contact@example.com`) unless the env var is set.

## Cost notes to relax under the Nov 2026 budget policy ($100+/month)
- `workers/common/config.py:41-47` and `.env.example:16-21`: caps of $5/day and $50/month; `EXTRACT_AUTO_MONTHS=18`; Batch off.
- Old models: `claude-sonnet-4-5` and `claude-haiku-4-5` (worker config, plus chat `route.ts:22`). The pricing table in `common/claude.py:23-26` is also stale.
- `extractor.py:66,68,69`: `SECTION_CHAR_BUDGET=80_000`, `TRIAGE_PAGE_LIMIT=2`, `MAX_DRILL_ROWS=40`. The resource fallback is `chunks[:12]` (`:404`).
- Haiku is used for drill results and QPs, which are numeric. The policy says use the stronger model where accuracy benefits.
- Nothing re-runs low-confidence extractions. Average resource confidence is 0.51.
- `docs/phase-2-3-plan.md:135,148,156-158,181-195,221` frame the design around a $20 backfill and $5/month steady state.
- Plan §5.3 "never send whole PDFs" and §11. Section targeting is still right for quality; only the tight caps are outdated.
- Keep (they fit the policy): Batch API for bulk jobs, newest-first ordering, the cost ledger.
- Embeddings stay tight: `embeddings.py` is built for the free tier (10K tokens/min, 9k per request). Add content-hash dedupe; do not loosen embedding volume.

## Open questions for you
1. Is the web app deployed (Vercel)? With Clerk keys and `ADMIN_CLERK_IDS` set?
2. Was the EC2 bot ever deployed? Should it be, or do you want to run workers locally for now?
3. Is the uncommitted SEDAR Chrome/DOM work tested against the live site? Can you do a headed session to finish the discovery in NOTES.md?
4. Extraction models: Sonnet 5.5 for everything, or Opus 5.5 for resources and economics?
5. Does Voyage have a payment method on file? (It changes the embedding rate limit.)
6. Monthly extraction budget to set as the cap (for example $80 of the $100)?

## Recommended next steps
Phase 1 is already reached, so these aim to get the pipeline running continuously with trustworthy facts.
1. **Extraction correctness fixes (about half a day).** Retry docs on a Claude outage instead of marking them extracted, fix the processor/extractor retry semantics, and fix the admin bypass in production. *Why: do these before spending more on extraction.*
2. **Apply the new budget policy to extraction (about 1 day).**
   - Current models and pricing table.
   - Caps set from your budget.
   - A larger section budget.
   - The stronger model for numeric tables.
   - Re-run rows below a confidence threshold.
   - Batch for bulk.

   Then drain the 42 pending jobs newest-first. *Why: the screener and profiles are nearly empty (9 docs).*
3. **Restart ingestion (about 1 day).** Run EDGAR, newswire, processor and extractor (EC2 via `make deploy`, or locally). Add the missing logs IAM permissions, skip known filings before download, and turn on the silent-death alarm. *Why: the corpus is 3 months stale.*
4. **Embedding and retrieval hygiene (half a day to 1 day).** Reuse embeddings by content hash, restructure the retrieval CTE so the indexes are used, and add a recency boost. *Why: respects the embedding limits and keeps chat fast as the corpus grows.*
5. **Unattended SEDAR+ (1–3 days, needs you).** Commit or finish the Chrome/DOM work, run a headed discovery session, fill in NOTES.md and the JSON URL, and get Chrome on the box (or a laptop runner). *Why: Canada is the core value, but this is blocked on operator time.*

## Your web setup checklist (things only you can do in dashboards and consoles)
The env var names come from the `.env.example` files. I did not read any secret values, so this checklist does not say which ones are already set.

**Vercel (web app)**
- [ ] Confirm the project is deployed from `apps/web` (root directory set to `apps/web`).
- [ ] Set these Production env vars: `DATABASE_URL_POOLED`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ADMIN_CLERK_IDS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (set it to a current model, e.g. `claude-sonnet-5-5`), `VOYAGE_API_KEY`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SEDAR_ALERT_WEBHOOK_SECRET`.
- [ ] The Clerk keys **must** be set in production, or every visitor is an admin (risk #3).

**Clerk**
- [ ] Create a production instance with Email and Google sign-in enabled, and add your Vercel domain.
- [ ] Sign in once, copy your user ID (`user_…`) from the Clerk dashboard, and put it in `ADMIN_CLERK_IDS`.

**Anthropic Console**
- [ ] Confirm credits and billing. Set a workspace monthly spend limit that matches your budget (a safety net on top of the app caps).
- [ ] Use one API key for the workers and one for Vercel, so spend is separable.

**Voyage AI**
- [ ] Add a payment method. Without one you are on the 10K tokens/minute free tier, which throttles processing. Check how much of the 200M free tokens is left.

**Neon**
- [ ] Copy the *pooled* connection string into Vercel and the direct one into workers/db.
- [ ] Check the compute size and autosuspend setting (the plan suggests 0.25 CU).

**AWS**
- [ ] Run `terraform apply` in `infra/terraform`. Add `logs:CreateLogGroup/CreateLogStream/PutLogEvents` first, which I'll do in step 3.
- [ ] Confirm the SNS email subscription for the silent-death alarm (AWS sends a confirmation link).
- [ ] Put worker secrets in SSM Parameter Store under `/orebase/` (names from `workers/.env.example`). Set `EDGAR_USER_AGENT` to a real contact email; the SEC requires it.
- [ ] Launch the EC2 t3.medium from `infra/RUNBOOK.md`, or decide to run workers locally for now.
- [ ] Check that Textract is available in your region before setting `OCR_BACKEND=textract`.

**Resend (email alerts and inbound SEDAR alerts)**
- [ ] Verify a sending domain, create an API key, and set `RESEND_API_KEY` and `ALERT_FROM_EMAIL`.
- [ ] Set up inbound email routing to `https://<your-vercel-domain>/api/ingest/sedar-alert`, using the same secret as `SEDAR_ALERT_WEBHOOK_SECRET`.

**SEDAR+**
- [ ] Subscribe that inbound address to SEDAR+ email alerts for NI 43-101 technical reports, material change reports and news releases.
- [ ] Do the DevTools discovery hour (plan §6.3): record the document-search JSON request in `workers/sedar/NOTES.md` and set `SEDAR_JSON_SEARCH_URL`.
- [ ] Solve the Radware challenge in a visible browser (headed) session on the machine that will run the bot. The profile is per machine and per browser.
- [ ] Read the SEDAR+ Terms of Use before any backfill (plan §10).
