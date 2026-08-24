-- migrate:up
-- Phase 4 close-out: watchlist uniqueness, event dedupe, scrape checkpoints,
-- and MinFile/USGS occurrence rows for the screener map.

DELETE FROM app.watchlist_items a
 USING app.watchlist_items b
 WHERE a.id > b.id
   AND a.watchlist_id = b.watchlist_id
   AND a.project_id IS NOT NULL
   AND a.project_id = b.project_id;

DELETE FROM app.watchlist_items a
 USING app.watchlist_items b
 WHERE a.id > b.id
   AND a.watchlist_id = b.watchlist_id
   AND a.company_id IS NOT NULL
   AND a.company_id = b.company_id;

CREATE UNIQUE INDEX watchlist_items_project_uidx
  ON app.watchlist_items (watchlist_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX watchlist_items_company_uidx
  ON app.watchlist_items (watchlist_id, company_id)
  WHERE company_id IS NOT NULL;

DELETE FROM core.project_events a
 USING core.project_events b
 WHERE a.id > b.id
   AND a.document_id IS NOT NULL
   AND a.document_id = b.document_id
   AND a.project_id = b.project_id
   AND a.event_type IS NOT DISTINCT FROM b.event_type;

CREATE UNIQUE INDEX project_events_doc_type_uidx
  ON core.project_events (project_id, document_id, event_type)
  WHERE document_id IS NOT NULL;

ALTER TABLE sedar.scrape_runs
  ADD COLUMN IF NOT EXISTS checkpoint jsonb;

CREATE TABLE core.geo_occurrences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,                         -- minfile | usgs
  external_id  text NOT NULL,
  name         text NOT NULL,
  country      text,
  region       text,
  lat          numeric NOT NULL,
  lng          numeric NOT NULL,
  commodities  text[],
  project_id   uuid REFERENCES core.projects(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX geo_occurrences_project_id_idx ON core.geo_occurrences (project_id);
CREATE INDEX geo_occurrences_unlinked_idx
  ON core.geo_occurrences (source)
  WHERE project_id IS NULL;

-- migrate:down
DROP INDEX IF EXISTS geo_occurrences_unlinked_idx;
DROP INDEX IF EXISTS geo_occurrences_project_id_idx;
DROP TABLE IF EXISTS core.geo_occurrences;
ALTER TABLE sedar.scrape_runs DROP COLUMN IF EXISTS checkpoint;
DROP INDEX IF EXISTS project_events_doc_type_uidx;
DROP INDEX IF EXISTS watchlist_items_company_uidx;
DROP INDEX IF EXISTS watchlist_items_project_uidx;
