# OreBase: what to build next (2026-11-18)

This file is a handoff for the next agents. It assumes you have read `STATUS.md` (the audit) and `mining-intel-platform-build-plan.md` (the plan).

## Where things stand

- **The data pipeline works end to end.** It has 72 filings: EDGAR 40, SEDAR 29 (uploaded by hand), newswire 3. Of those, 69 are fully extracted. The core tables hold 541 resource rows, 746 drill rows, 27 economics rows, 149 qualified persons, 63 projects and 50 companies.
  - 88% of resource rows score 0.7 confidence or higher.
- **The web app runs locally against this data.** The screener, company pages, project pages, chat with citations, PDF viewer, watchlist, research and admin review pages all work.
  - **It is not deployed anywhere.** There is no `.vercel` link and no Clerk keys, so nobody but the owner, on their own laptop, has seen it.
- **Nothing runs on a schedule.** Ingestion and extraction only run when someone starts them by hand.
- **Extraction spend:** $34 of the $80 November cap is used. The cap resets on Dec 1. The cost ledger is `app.extraction_costs`, and `/admin` shows spend.

Run the app locally:
```bash
cd apps/web
DEV_ADMIN_BYPASS=true npx next dev
```
The database URL and API keys are already in `apps/web/.env.local`.

The work splits into two lanes that can run in parallel. **App agent: only edit `apps/web/`. Backfill agent: only edit `workers/` and `db/`.** If the app needs a schema change, ask the backfill lane. Only the backfill lane spends Claude credits.

---

## Lane A: app ("make it something to show")

Do these in order. Each one is visible on its own.

1. **Fix the font (one line).** In `apps/web/src/app/globals.css:10`, `--font-sans: var(--font-sans)` refers to itself. The whole app therefore falls back to the browser's serif font, which is the main reason it looks unfinished. It should point at `--font-geist-sans`, which is set in `layout.tsx`.
2. **Deploy to Vercel.**
   - Set the project root to `apps/web` and add the Production env vars listed in `STATUS.md` under "Your web setup checklist".
   - The owner sets the Clerk keys and `ADMIN_CLERK_IDS` themselves.
   - Without Clerk keys, admin is closed (this is intentional).
   - Set `ANTHROPIC_MODEL=claude-sonnet-5-5`. The chat route still defaults to `claude-sonnet-4-5` (`app/api/chat/route.ts`); change that default too.
3. **A real home page.** Today `/` redirects to an empty chat. Build a dashboard from data that already exists:
   - new filings this week
   - the latest resource and reserve updates (`core.project_events`, `core.resource_estimates`)
   - watchlist activity
   - corpus counts
   - a few suggested chat questions

   Reuse the components in `components/intel/`, such as `event-feed` and `project-card`.
4. **Project page that reads like a resource statement.** The page lists every row flat today.
   - Group rows by report and effective date, then by `domain`; the zone qualifier is a new column.
   - Show reserves and resources separately, with M+I and Inferred totals and contained metal.
   - Show economics.
   - Hide or collapse rows below 0.7 confidence behind an "unverified" toggle.
5. **Screener correctness.** The "Tonnes" column mixes reserve and resource rows and different domains. It should show one comparable figure per project: the latest M+I total, from a `domain` that is null, 'total' or inclusive. Add contained metal and a commodity-aware grade column.
6. **Map.** Every project shows "No coordinates yet".
   - Triage summaries often contain coordinates, e.g. "lat 48°08'N, long 77°54'W". The cheap fix is to have the triage step return `lat`/`lng`; that is a backfill-lane change, so ask for it.
   - Meanwhile the geo loaders exist (`workers/geo`, `geo.load --match`).
   - The map component is `components/intel/mini-map.tsx`, plus the screener's Map view.
7. **Chat polish.** Add an empty state with example questions drawn from real projects. Make citations show the company and project, not only the filing.
8. **Smaller items:**
   - `/documents` never goes network-idle; something polls. Find it.
   - The retrieval CTE is referenced twice and there is no recency boost (`lib/retrieval.ts`; see `STATUS.md` risk 6).

How to check your work: `npx tsc --noEmit`, `npx eslint src`, and actually open each page you change. Take a Playwright screenshot if you can't open a browser.

## Lane B: backfill (5 years of EDGAR, then SEDAR)

Read these first:
- `workers/extractor.py`
- `workers/common/{claude,config,extract_schemas,db}.py`
- the Nov 2026 budget policy, quoted in `STATUS.md`

**Model and budget facts**
- **Models:** Sonnet 5.5 is the default, with Opus 5.5 escalation below 0.7 confidence. Average cost today is about $0.27 per EDGAR report and $0.48 per SEDAR report.
- **Budget:** $80/month is a hard stop and $15/day only alerts. Pace the backfill to the monthly budget, newest first.
- **Haiku 5.5 is about 14× cheaper.** On 10 reports it matched Sonnet's grades 149/149. Its one failure, tonnage reported in Mt, is now guarded: the model reports `tonnage_unit` and the code converts it. Rows under 10,000 t are capped at 0.5 confidence.

**Tasks, in order**
1. **Embedding is not the bottleneck.** On 2026-11-18, Voyage embedded about 3.3M tokens (21 reports, about 150K tokens each) in about 18 minutes with zero rate-limit errors, so the 10K tokens/minute free-tier throttle does not apply to this account. Expect about 60M tokens and a few hours for about 400 EDGAR reports, well inside the 200M free allowance. Don't loosen embedding rules: no re-embedding unchanged text.
2. **Backfill cost tier: done (2026-11-18). Read this before running the backfill.**
   - Filings older than `EXTRACT_AUTO_MONTHS` (18) automatically use the backfill tier (`extractor.py::_models_for`):
     - Haiku 5.5 reads triage, resources and qualified persons.
     - Sonnet 5.5 reads economics and drills, and re-checks any Haiku row below 0.7.
     - Every call goes through Batch (50% off).
     - Newer filings and undated uploads keep Sonnet with the Opus re-check.
   - Only each project's **latest** technical report gets full extraction (`should_full_extract`); superseded reports get triage only. Watchlisted projects and `full_extract` jobs (a user opening a filing) still get everything.
   - Batch submits one request per call, and `--workers N` runs N documents at once so the waits overlap. Use `python extractor.py --workers 20`.
   - A batch that hits the 24h expiry is cancelled before the job retries, so nothing is billed twice.
   - Expected cost: about $0.05–0.10 per backfill report, against $0.27–0.48 on the live tier.
   - Self-check: `uv run python -m tests.test_backfill_tier`.
   - **Still open:**
     - Spot-check about 20 backfill reports against Sonnet before running hundreds (re-create `haiku_eval` under `workers/scripts/`).
     - Undated SEDAR zips go to the live tier until dates are added (CSV import).
     - A true many-requests-per-batch submitter would cut per-call wait overhead, but isn't needed at this volume.
3. **EDGAR historical catch-up.**
   - Run `edgar_poller.py --date-from/--date-to --limit` in monthly windows, back to 2021.
   - Known filings are skipped before download.
   - Recent windows yielded about 5–8 technical-report exhibits (EX-96) per month, so expect about 300–500 reports in total.
   - Two exhibits time out in HTML→PDF rendering at 120s; see the list in `STATUS.md`/chat. Add a longer timeout or a text-only fallback.
4. **Extraction depth for old filings:** done; see item 2 (latest report per project).
5. **Schedule it.** Run processor, extractor, EDGAR and newswire as long-running local processes (launchd or tmux), or on EC2 via `make deploy`. Turn on the silent-death alarm.
6. **SEDAR+ backfill** is blocked on automated search (Radware; `sedar/NOTES.md`). The manual path works: the owner downloads zip files from SEDAR+, then run `python -m sedar.ingest_local --zip …`. Don't build scraping that evades bot protection.

**Data cleanup the owner asked about**
- **`4c5f0bfc` (Ivanhoe):** 38 bad rows from the old HTML table parser, kept because 9 rows were human-reviewed. Delete only with the owner's OK.
- **`997a60d7`:** 22 rows at 0.4 confidence. Its grade keys don't fit the expected format, probably heavy-mineral-sands units.
- **3 documents** are only triaged (Newcore Gold, Granada Gold, DRDGOLD). Check why.

How to check your work:
```bash
uv run python -m tests.test_extract_safety
uv run python -m tests.test_resource_normalize
```
Also, before any run that spends money, do a `--dry-run` cost estimate.
