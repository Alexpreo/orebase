# DATA_GAPS — UI redesign

Panels in docs/design that have no real data yet. Each one renders an empty state or is hidden; none show placeholder numbers.

| Panel | Missing data | Suggested fix |
|---|---|---|
| Chat · "Facts extracted from this page" | Facts carry only `document_id`, no page | Add `page_start int` to `core.resource_estimates`, `core.project_economics`, `core.drill_results` (schema change) and have the extractor fill it |
| Chat · step trace on saved chats | `persistChat` stores text + citations only; tool parts are dropped | Store tool parts in `app.chat_messages` (e.g. `parts jsonb`) (schema change). Live answers already show the trace |
| Chat · figure flash inside the PDF | No text coordinates for cited figures | Needs per-fact page + bbox from the parser |
| Home · "Last 7 days" range switch | — (only 7 days implemented) | Add `?range=` to the briefing queries if wanted |
| Home · projects coordinates (Screener map later) | `core.projects.lat/lng` are null for all 63 projects | Geo-link projects (admin GeoLinkForm / worker) |

Not schema gaps, but sourced from env rather than the DB:
- Monthly extraction cap: `EXTRACTION_MONTHLY_CAP_USD` (default 80, mirrors workers/common/config.py).
