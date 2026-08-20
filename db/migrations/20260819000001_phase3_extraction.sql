-- migrate:up
-- Phase 3: review flags on remaining fact tables, CIK uniqueness for EDGAR
-- resolution, triage summary on documents, and saved screener filter sets.

ALTER TABLE core.drill_results
  ADD COLUMN reviewed boolean NOT NULL DEFAULT false;

ALTER TABLE core.project_economics
  ADD COLUMN reviewed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX companies_cik_unique
  ON core.companies (cik)
  WHERE cik IS NOT NULL;

ALTER TABLE raw.documents
  ADD COLUMN summary text;

CREATE TABLE app.saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  criteria   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_filters_user_id_idx ON app.saved_filters (user_id);

-- Recreate chat views so reviewed is visible through the whitelist.
DROP VIEW IF EXISTS core.v_drill_results;
CREATE VIEW core.v_drill_results AS
SELECT id, project_id, document_id, hole_id, announced_date, from_m, to_m,
       interval_m, assays, true_width_noted, extraction_confidence, reviewed
FROM core.drill_results;

DROP VIEW IF EXISTS core.v_project_economics;
CREATE VIEW core.v_project_economics AS
SELECT id, project_id, document_id, study_type, effective_date, currency, npv,
       irr_pct, capex_initial, aisc, mine_life_years, payback_years,
       metal_price_assumptions, extraction_confidence, reviewed
FROM core.project_economics;

GRANT SELECT ON core.v_drill_results, core.v_project_economics TO orebase_chat;

-- migrate:down
REVOKE SELECT ON core.v_drill_results, core.v_project_economics FROM orebase_chat;

DROP VIEW IF EXISTS core.v_project_economics;
CREATE VIEW core.v_project_economics AS
SELECT id, project_id, document_id, study_type, effective_date, currency, npv,
       irr_pct, capex_initial, aisc, mine_life_years, payback_years,
       metal_price_assumptions, extraction_confidence
FROM core.project_economics;

DROP VIEW IF EXISTS core.v_drill_results;
CREATE VIEW core.v_drill_results AS
SELECT id, project_id, document_id, hole_id, announced_date, from_m, to_m,
       interval_m, assays, true_width_noted, extraction_confidence
FROM core.drill_results;

GRANT SELECT ON core.v_drill_results, core.v_project_economics TO orebase_chat;

DROP INDEX IF EXISTS app.saved_filters_user_id_idx;
DROP TABLE IF EXISTS app.saved_filters;

ALTER TABLE raw.documents DROP COLUMN IF EXISTS summary;

DROP INDEX IF EXISTS core.companies_cik_unique;

ALTER TABLE core.project_economics DROP COLUMN IF EXISTS reviewed;
ALTER TABLE core.drill_results DROP COLUMN IF EXISTS reviewed;
