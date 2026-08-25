# Phase 4 Close-Out — live Canada ingest

Working plan for finishing Phase 4. Scope and architecture source of truth remains
[mining-intel-platform-build-plan.md](../mining-intel-platform-build-plan.md).

[phase-2-3-plan.md](phase-2-3-plan.md) is historical: its “Not built” SEDAR/newswire
line is stale. Use this document for remaining Phase 4 work.

**Parked (moved to Phase 5):** ASX, Slack alerts, orgs/Stripe, research charts,
chat filter panel, multi-watchlist CRUD. Remaining work lives in
[phase-5-plan.md](phase-5-plan.md).

**Baseline:** commit the existing Phase 3 + incremental Phase 4 tree before relying
on this close-out as the next delta.

## Status

- [x] Stream 0 — Fact path (triage vs full extract, events, entity link, watchlist unique)
- [x] Stream 1 — SEDAR+ incremental (Path 1 from env, pagination, headed profile, fetch)
- [x] Stream 2 — Always-on bot (SSM entrypoint, CloudWatch logs overlay, SEDAR alarm muted)
- [x] Stream 3 — Geo + screener map (MinFile/USGS loaders, mini-map)
- [x] Stream 4 — Gated backfill (pagination + checkpoint; Batch API; EDGAR date-from)

Path 1 JSON replay stays **off** until `SEDAR_JSON_SEARCH_URL` is set from a live
DevTools session. Fill [workers/sedar/NOTES.md](../workers/sedar/NOTES.md) first,
then `uv run python -m sedar.incremental --headful --limit 1`.

## Success

A new Canadian NI 43-101 is detected (alert or nightly), lands in S3/`raw.documents`,
extracts into `core.*`, shows on a project page, and can page a watchlist email —
without a manual PDF copy. Historical slices stay opt-in (`--confirm-backfill`).

## Manual steps (not code)

1. Chrome DevTools on sedarplus.ca public search → fill NOTES.md blanks / env vars.
2. Headed Playwright once so `~/.sedar_profile` holds a solved Radware challenge.
3. EC2 t3.medium per [infra/RUNBOOK.md](../infra/RUNBOOK.md); `terraform apply` with
   `enable_sedar_alarm = false` until the first SEDAR document.
4. Clerk keys on any public Vercel deploy. Resend inbound → `POST /api/ingest/sedar-alert`.
5. Download BC MinFile / USGS CSVs and run `uv run python -m geo.load`.
