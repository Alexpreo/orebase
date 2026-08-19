-- migrate:up
-- query_database runs LLM-authored SQL. These views are the whitelist; the
-- orebase_chat role can SELECT only them, and is read-only with a statement
-- timeout. The app connects as neondb_owner and SET ROLE orebase_chat inside
-- BEGIN; SET TRANSACTION READ ONLY;
CREATE VIEW core.v_companies AS
SELECT id, name, tickers, hq_country, website, cik, sedar_profile
FROM core.companies;

CREATE VIEW core.v_projects AS
SELECT id, company_id, name, country, region, lat, lng, commodities, stage,
       ownership_notes, created_at, updated_at
FROM core.projects;

CREATE VIEW core.v_resource_estimates AS
SELECT id, project_id, document_id, effective_date, category, tonnes, grade,
       contained_metal, cutoff, standard, extraction_confidence, reviewed
FROM core.resource_estimates;

CREATE VIEW core.v_drill_results AS
SELECT id, project_id, document_id, hole_id, announced_date, from_m, to_m,
       interval_m, assays, true_width_noted, extraction_confidence
FROM core.drill_results;

CREATE VIEW core.v_project_economics AS
SELECT id, project_id, document_id, study_type, effective_date, currency, npv,
       irr_pct, capex_initial, aisc, mine_life_years, payback_years,
       metal_price_assumptions, extraction_confidence
FROM core.project_economics;

CREATE VIEW core.v_qualified_persons AS
SELECT id, name, designation, firm
FROM core.qualified_persons;

CREATE VIEW core.v_document_qps AS
SELECT document_id, qp_id, role
FROM core.document_qps;

CREATE VIEW core.v_project_events AS
SELECT id, project_id, document_id, event_type, event_date, summary
FROM core.project_events;

CREATE ROLE orebase_chat NOLOGIN NOINHERIT;

ALTER ROLE orebase_chat SET default_transaction_read_only = on;
ALTER ROLE orebase_chat SET statement_timeout = '5s';

GRANT USAGE ON SCHEMA core TO orebase_chat;
GRANT SELECT ON
  core.v_companies,
  core.v_projects,
  core.v_resource_estimates,
  core.v_drill_results,
  core.v_project_economics,
  core.v_qualified_persons,
  core.v_document_qps,
  core.v_project_events
TO orebase_chat;

GRANT orebase_chat TO neondb_owner;

-- migrate:down
REVOKE orebase_chat FROM neondb_owner;
REVOKE SELECT ON
  core.v_companies,
  core.v_projects,
  core.v_resource_estimates,
  core.v_drill_results,
  core.v_project_economics,
  core.v_qualified_persons,
  core.v_document_qps,
  core.v_project_events
FROM orebase_chat;
REVOKE USAGE ON SCHEMA core FROM orebase_chat;
DROP ROLE IF EXISTS orebase_chat;

DROP VIEW IF EXISTS core.v_project_events;
DROP VIEW IF EXISTS core.v_document_qps;
DROP VIEW IF EXISTS core.v_qualified_persons;
DROP VIEW IF EXISTS core.v_project_economics;
DROP VIEW IF EXISTS core.v_drill_results;
DROP VIEW IF EXISTS core.v_resource_estimates;
DROP VIEW IF EXISTS core.v_projects;
DROP VIEW IF EXISTS core.v_companies;
