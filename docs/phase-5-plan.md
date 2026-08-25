# Phase 5 — Live Canada ingest and daily-use close

Working plan for proving unattended NI 43-101 ingest and closing the parked
§7 product gaps. Scope and architecture source of truth remains
[mining-intel-platform-build-plan.md](../mining-intel-platform-build-plan.md).

[phase-4-plan.md](phase-4-plan.md) is complete as **code**; its success criterion
(a Canadian filing without a manual PDF) is the Stream 1 milestone here.

**Parked:** ASX, Slack alerts, orgs/teams/Stripe, data licensing, multi-watchlist
CRUD, historical SEDAR backfill as a compose service, Accesswire feed, `/projects`
index.

**Baseline:** `2116dd1` *Phase4: geo map, admin & SEDAR updates*.

## Status

- [x] Stream 0 — `docs/phase-5-plan.md` + README pointer
- [x] Stream 1a — Admin ingest status; Path 1 mapper stays contract-strict
- [ ] Stream 1b — Operator: headed Path 1 / alert → extract → watchlist email
- [x] Stream 2 — Chat filters, last-visit, company timeline, research chart,
  screener sort, admin Clerk allowlist
- [x] Stream 3 — Gated corpus scale documented in [infra/RUNBOOK.md](../infra/RUNBOOK.md)

Path 1 JSON replay stays **off** until `SEDAR_JSON_SEARCH_URL` is set from a live
DevTools session. Fill [workers/sedar/NOTES.md](../workers/sedar/NOTES.md) first,
then `uv run python -m sedar.incremental --headful --limit 1`.

## Success

A weekday morning: a new Canadian filing is in the corpus without a human PDF,
Watchlist shows it as new, email went out, Chat can be scoped to that issuer from
the filter panel, Research shows the filing in the firehose.

## Operator tracks (not code)

Do Track A first. Track B is always-on detection. Track C is 24/7 workers.
Track D is corpus scale after `/admin/review` is quiet. Full steps live in the
Phase 5 Cursor plan and [infra/RUNBOOK.md](../infra/RUNBOOK.md).

1. Chrome DevTools on sedarplus.ca → NOTES.md + `SEDAR_JSON_SEARCH_*` in
   `workers/.env` (never commit a tokenized URL).
2. Headed Playwright once: `uv run python -m sedar.incremental --headful --limit 1`.
3. Resend inbound → `POST /api/ingest/sedar-alert`. Worker `RESEND_API_KEY` +
   `ALERT_FROM_EMAIL` for outbound.
4. Clerk keys + `ADMIN_CLERK_IDS` on any public Vercel deploy.
5. EC2 t3.medium per the runbook; `enable_sedar_alarm = false` until the first
   SEDAR document. Solve Radware **on the box** (laptop profile is a different
   cookie jar).
6. After review is quiet: MinFile/USGS `geo.load`, EDGAR `--date-from 2021-06-01`,
   SEDAR `--confirm-backfill --slice ni43101_2024_present`.
