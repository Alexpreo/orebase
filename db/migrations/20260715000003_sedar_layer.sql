-- migrate:up
-- company_id references core.companies (created later); FK added via ALTER in the core migration.
CREATE TABLE sedar.sedar_issuers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_number text UNIQUE,
  name           text,
  jurisdiction   text,
  industry       text,
  company_id     uuid,
  active         boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz
);

CREATE TABLE sedar.pending_fetches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL DEFAULT 'sedar',
  issuer_profile text,
  document_type  text,
  filed_date     date,
  external_ref   text,                               -- doc GUID/URL from alert or search
  discovered_via text,                               -- 'email_alert' | 'nightly_search' | 'backfill'
  status         text NOT NULL DEFAULT 'pending',    -- pending | fetched | failed | skipped_dupe
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sedar.scrape_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode           text,                               -- backfill | incremental
  slice          text,                               -- e.g. 'ni43101_2024_2026'
  started_at     timestamptz,
  finished_at    timestamptz,
  docs_found     int,
  docs_fetched   int,
  challenges_hit int,
  notes          text
);

-- migrate:down
DROP TABLE IF EXISTS sedar.scrape_runs;
DROP TABLE IF EXISTS sedar.pending_fetches;
DROP TABLE IF EXISTS sedar.sedar_issuers;
