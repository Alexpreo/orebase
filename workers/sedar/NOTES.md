# SEDAR+ discovery notes

SEDAR+ has **no official public API**. The public search UI is a JS SPA at
[sedarplus.ca](https://www.sedarplus.ca) behind Radware bot protection. This
file is the living record of how we talk to it. Update it after every discovery
session; Path 1 reads `SEDAR_JSON_SEARCH_URL` (and optional body JSON).

## Canada-first ingest (works today)

Headless search against sedarplus.ca returns **403** until a headed session has
solved Radware into `SEDAR_PROFILE_DIR` (default `~/.sedar_profile`).

Canadian NI 43-101s still go through `raw.documents` (`source=sedar`,
`doc_type=ni43101`) → parse → extract:

1. Download the PDF in a **normal Chrome window** (SEDAR+ or the issuer IR site).
2. Admin: `/admin` → Canada filing upload (local / small files).
3. Worker: `uv run python -m sedar.ingest_local --file report.pdf --issuer "…" --filed-at YYYY-MM-DD`
4. Issuer IR PDF URL (not a sedarplus.ca link): `--url https://…/report.pdf`
5. After ingest, run `processor.py` then `extractor.py --once`.

Other Canadian channels that do not need the search WAF:

- SEDAR+ **email alerts** → `POST /api/ingest/sedar-alert`
- Newsfile + GlobeNewswire RSS (`newswire_poller.py`)
- Dual-listed issuers already land SK-1300s via EDGAR

Unattended search: `uv run python -m sedar.incremental --headful --limit 1` once,
then headless using the saved profile. Historical `backfill.py` stays gated.

## Discovery hour (do this on a real browser before scaling)

Open Chrome DevTools → Network on the public document search and fill:

1. Search JSON request: method, URL, payload keys, cookies/tokens.
2. Result row shape: issuer name, profile number, document type, submitted
   date, document GUID / download URL.
3. PDF download URL pattern (today: `viewInstance/resource.html?node=&drmKey=`).
4. Pagination: page size default 30, max public download 30 at a time.
5. Reporting Issuers List export: where the CSV/XLSX lives and the column names.

Then set env (never commit the live URL if it embeds a session token):

```
SEDAR_JSON_SEARCH_URL=https://www.sedarplus.ca/...
SEDAR_JSON_SEARCH_METHOD=POST
SEDAR_JSON_SEARCH_BODY={"documentType":"{document_type}","fromDate":"{date_from}","toDate":"{date_to}","offset":"{offset}"}
```

Leave `SEDAR_JSON_SEARCH_URL` empty to skip Path 1. `search.py` then uses Path 2
(DOM) only. Path 1 is enabled as soon as the URL is set; a schema mismatch stops
the run instead of inventing rows.

## Known public surface (mid-2026)

- Search UI: `https://www.sedarplus.ca/csa-party/viewInstance/view.html?id=0c11f8b7998bcd96fb9cb36b800b9dfdd7cbf07b7cf2bde3`
- Document download links look like
  `https://www.sedarplus.ca/csa-party/viewInstance/resource.html?node=W517&drmKey=...&id=...`
- Results table columns: Profile(s), Document, Submitted date, Principal
  jurisdiction, File size, Actions (Generate URL).
- Public users may download 30 documents per request.
- Email alerts exist for new disclosure documents (incremental ingest channel).

## Path 1 JSON (fill after discovery)

Recorded here so a later session can diff the contract. Runtime values come from
env, not this file.

```
JSON_SEARCH_URL=
JSON_SEARCH_METHOD=POST
JSON_SEARCH_BODY_KEYS=documentType,fromDate,toDate,offset
RESULT_LIST_KEYS=results|items|data|documents|rows|content|records
ROW_KEYS=documentName|document_name|title|name, profileName|profile|issuer,
  profile_number|profileNumber, submitted_date|filed_at|submittedDate,
  download_url|url|downloadUrl, id|guid|documentId
BODY_PLACEHOLDERS={document_type},{date_from},{date_to},{offset},{page},{limit},{page_size}
```

## Path 2 DOM selectors (update if the SPA ships a quarterly restyle)

These are starting points against the public search page, not guaranteed
stable. `search.py` treats a miss as a selector failure and stops the run
instead of inventing rows.

- Document type input: `input` whose accessible name / label contains "Document type"
- Date from / to: labels "From" / "To" or `input[type=date]`
- Search button: `button` / `input` named "Search"
- Results table: `table` with a "Submitted date" header
- Next page: control named "Next" or pagination page numbers

## Rate and legal

- 1 request per 4–8s with jitter. 60–120s pause between result pages.
- Max 20 docs/day until review stays empty (`SEDAR_DAILY_FETCH_CAP`).
- Persistent Playwright profile at `SEDAR_PROFILE_DIR`.
- No proxy rotation, no fingerprint spoofing. Radware challenge → pause,
  notify (`SEDAR_CHALLENGE_SNS_ARN`), `--headful` takeover, resume.
- Historical slices (`backfill.py`) require `--confirm-backfill` and are not
  wired into docker-compose.

## Document type mapping we assign

| SEDAR+ label (contains) | `raw.documents.doc_type` |
|---|---|
| Technical Report / NI 43-101 | `ni43101` |
| Material change | `mda` (until a dedicated type is added) |
| News release / press | `press_release` |
| MD&A | `mda` |
| AIF / Annual Information | `financials` |
| PEA / Preliminary Economic | `pea` |
| PFS / Pre-Feasibility | `pfs` |
| Feasibility | `fs` |
