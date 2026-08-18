-- migrate:up
CREATE TABLE core.companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  tickers       jsonb,                               -- [{"exchange":"TSXV","symbol":"ABC"}]
  hq_country    text,
  website       text,
  cik           text,
  sedar_profile text
);

CREATE TABLE core.projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES core.companies(id) ON DELETE SET NULL,
  name            text NOT NULL,
  country         text,
  region          text,
  lat             numeric,
  lng             numeric,
  commodities     text[],                            -- ['Cu','Au','Mo']
  stage           text,                              -- grassroots | exploration | resource | pea | pfs | fs | ...
  ownership_notes text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.resource_estimates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
  document_id           uuid REFERENCES raw.documents(id) ON DELETE SET NULL,   -- provenance
  effective_date        date,
  category              text,                        -- measured | indicated | inferred | proven | probable
  tonnes                numeric,
  grade                 jsonb,                        -- {"Cu_pct":0.45,"Au_gpt":0.31}
  contained_metal       jsonb,                        -- {"Cu_lb":1.2e9,"Au_oz":450000}
  cutoff                text,
  standard              text,                         -- 'NI43-101' | 'SK-1300' | 'JORC'
  extraction_confidence numeric,
  reviewed              boolean NOT NULL DEFAULT false
);

CREATE TABLE core.drill_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
  document_id           uuid REFERENCES raw.documents(id) ON DELETE SET NULL,
  hole_id               text,
  announced_date        date,
  from_m                numeric,
  to_m                  numeric,
  interval_m            numeric,
  assays                jsonb,
  true_width_noted      boolean,
  extraction_confidence numeric
);

CREATE TABLE core.project_economics (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
  document_id             uuid REFERENCES raw.documents(id) ON DELETE SET NULL,
  study_type              text,                       -- pea | pfs | fs
  effective_date          date,
  currency                text,
  npv                     jsonb,                       -- {"post_tax_5pct":512000000}
  irr_pct                 numeric,
  capex_initial           numeric,
  aisc                    jsonb,
  mine_life_years         numeric,
  payback_years           numeric,
  metal_price_assumptions jsonb,
  extraction_confidence   numeric
);

CREATE TABLE core.qualified_persons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  designation text,
  firm        text
);

CREATE TABLE core.document_qps (
  document_id uuid NOT NULL REFERENCES raw.documents(id) ON DELETE CASCADE,
  qp_id       uuid NOT NULL REFERENCES core.qualified_persons(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT '',
  PRIMARY KEY (document_id, qp_id, role)
);

CREATE TABLE core.project_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
  document_id uuid REFERENCES raw.documents(id) ON DELETE SET NULL,
  event_type  text,                                  -- new_report | resource_update | drill_results | ...
  event_date  date,
  summary     text
);

-- Cross-schema FKs from earlier layers into core, now that core.* exists.
ALTER TABLE raw.documents
  ADD CONSTRAINT documents_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES core.companies(id) ON DELETE SET NULL,
  ADD CONSTRAINT documents_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES core.projects(id) ON DELETE SET NULL;

ALTER TABLE sedar.sedar_issuers
  ADD CONSTRAINT sedar_issuers_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES core.companies(id) ON DELETE SET NULL;

-- migrate:down
ALTER TABLE sedar.sedar_issuers DROP CONSTRAINT IF EXISTS sedar_issuers_company_id_fkey;
ALTER TABLE raw.documents DROP CONSTRAINT IF EXISTS documents_project_id_fkey;
ALTER TABLE raw.documents DROP CONSTRAINT IF EXISTS documents_company_id_fkey;

DROP TABLE IF EXISTS core.project_events;
DROP TABLE IF EXISTS core.document_qps;
DROP TABLE IF EXISTS core.qualified_persons;
DROP TABLE IF EXISTS core.project_economics;
DROP TABLE IF EXISTS core.drill_results;
DROP TABLE IF EXISTS core.resource_estimates;
DROP TABLE IF EXISTS core.projects;
DROP TABLE IF EXISTS core.companies;
