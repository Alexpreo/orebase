# OreBase EC2 ingestion bot

The compose file in this directory is the always-on worker fleet for an
**EC2 t3.medium**. It is not required for local development (`uv run python …`
from `workers/` is enough).

## First-time box

1. Ubuntu 24.04, 20 GB gp3 EBS, security group: SSH from your IP only.
2. Install Docker + Compose plugin.
3. Clone the repo to `/opt/orebase`.
4. Put secrets in SSM under `/orebase/` (`DATABASE_URL`, `S3_BUCKET`, …) and set
   `SSM_PREFIX=/orebase` for compose, or a root-owned `/opt/orebase/workers/.env`
   that is never copied off the box.
5. `make deploy` from `infra/` (compose + CloudWatch Logs overlay). Local
   `make up` skips the overlay.

## Headful Radware solve (SEDAR+)

When incremental ingest logs `ChallengeDetected`:

```bash
# from your laptop
ssh -L 5900:localhost:5900 ubuntu@<ec2-host>

# on the box
cd /opt/orebase/infra
docker compose stop sedar-incremental
docker compose run --rm -e SEDAR_HEADFUL=1 -p 5900:5900 sedar-incremental \
  uv run python -m sedar.incremental --headful --limit 1
```

Solve the challenge in the Chromium window. The persistent volume
`sedar_profile` keeps cookies for the next headless run. Then
`docker compose start sedar-incremental`.

Simpler path if you have a desktop on the box: set `SEDAR_HEADFUL=1` in the
service env, attach with VNC, solve once, unset headful.

## Silent-death alarm

`healthcheck` publishes `OreBase/DocumentsLast24h` per source every hour.
Terraform creates CloudWatch alarms that fire when that metric is `< 1` for
24 hours (missing data counts as breaching). Confirm the SNS topic in
`terraform.tfvars` before apply. Keep `enable_sedar_alarm = false` until the
first SEDAR document exists; set `SEDAR_CHALLENGE_SNS_ARN` to the ingest topic
ARN so Radware pauses page the same inbox.

Use the topic ARN from `terraform output ingest_alarm_topic_arn`.

## Clerk (production web)

Create a Clerk application (email + Google). Local web runs without keys.
Any public Vercel deploy **must** set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY`. `apps/web/src/proxy.ts` refuses to skip auth when
`NODE_ENV=production`. Set `ADMIN_CLERK_IDS` to your Clerk user id (comma-separated)
or `/admin` and `/api/admin/*` stay closed. `/api/ingest/*` stays public.

## Prove the unattended Canada loop

After Path 1 env and a headed profile (see `workers/sedar/NOTES.md`):

1. `uv run python -m sedar.incremental --headful --limit 1` (or `--nightly` once
   the profile is solved). Confirm `/admin` shows a `source=sedar` row or a
   `pending_fetches` count.
2. Smoke-test the webhook:

```bash
curl -sS -X POST "http://localhost:3000/api/ingest/sedar-alert?secret=$SEDAR_ALERT_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"subject":"NI 43-101 filed","text":"https://www.sedarplus.ca/csa-party/viewInstance/resource.html?node=W517&drmKey=test"}'
```

A test `drmKey` will enqueue then fail download. A real alert URL is required
for the full fetch. Then drain with `sedar.incremental`, `processor.py`,
`extractor.py --once`. The project page and a watchlist email (`alerts.py --once`
with `RESEND_API_KEY`) complete the loop.

3. After the first real SEDAR document: `enable_sedar_alarm = true` and
   `terraform apply`.

## Canadian NI 43-101s (no search)

SEDAR+ search is WAF-blocked from the box until a headed profile exists. Copy
PDFs onto the host and ingest:

```bash
cd /opt/orebase/workers
uv run python -m sedar.ingest_local --file /opt/orebase/inbox/report.pdf \
  --issuer "Foran Mining" --title "McIlvenna Bay" --filed-at 2024-11-01
```

Then let `processor` and `extractor` drain as usual. Issuer IR `--url` works;
sedarplus.ca download URLs do not.

## SEDAR+ email alerts

Point Resend inbound (or SEDAR+ alert forwarding) at:

`POST https://<web-host>/api/ingest/sedar-alert?secret=$SEDAR_ALERT_WEBHOOK_SECRET`

Header alternative: `x-orebase-secret: $SEDAR_ALERT_WEBHOOK_SECRET`

Accepts `{ "subject", "text", "html" }` or Resend's `{ "data": { "subject", "text", "html" } }` envelope.

Set worker `RESEND_API_KEY` and `ALERT_FROM_EMAIL` for outbound watchlist mail.

Alternatively run `uvicorn sedar.alerts_ingester:app` on the box / Lambda.

## Geo (MinFile / USGS)

Download the CSVs, then from `workers/`:

```bash
uv run python -m geo.load --source minfile --file ~/data/minfile.csv
uv run python -m geo.load --source usgs --file ~/data/mrds.csv
uv run python -m geo.load --match
```

Confirmed matches write `core.projects.lat/lng`. Unmatched rows stay on `/admin/review`.

## What this compose does not run

These stay opt-in after `/admin/review` is quiet. Do not add them as compose
services.

**EDGAR SK-1300 since mid-2021** (complete US set; SK-1300 took effect then):

```bash
cd /opt/orebase/workers
uv run python edgar_poller.py --date-from 2021-06-01 --limit 500
```

Leave the 15-minute compose `edgar-poller` loop on the default incremental
window.

**SEDAR Slice 1** (NI 43-101 2024–present). Needs a headed-capable profile:

```bash
cd /opt/orebase/workers
uv run python -m sedar.backfill --confirm-backfill --slice ni43101_2024_present
```

**Geo coordinates:** download [BC MinFile](https://catalogue.data.gov.bc.ca/dataset/minfile-mineral-occurrence-database)
and USGS MRDS CSVs, then `geo.load` as above. Unmatched rows stay on `/admin/review`.
