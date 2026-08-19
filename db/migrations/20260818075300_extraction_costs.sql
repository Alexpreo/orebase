-- migrate:up
-- Per-call token spend for triage and structured extraction. Caps and the admin
-- spend-to-date view sum cost_usd by created_at; document_id is nullable so
-- deleting a filing does not erase the ledger.
CREATE TABLE app.extraction_costs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid REFERENCES raw.documents(id) ON DELETE SET NULL,
  model                 text NOT NULL,
  purpose               text,                          -- triage | extract | classify | other
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cost_usd              numeric(12, 6) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX extraction_costs_created_at_idx
  ON app.extraction_costs (created_at);
CREATE INDEX extraction_costs_document_id_idx
  ON app.extraction_costs (document_id);

-- migrate:down
DROP INDEX IF EXISTS app.extraction_costs_document_id_idx;
DROP INDEX IF EXISTS app.extraction_costs_created_at_idx;
DROP TABLE IF EXISTS app.extraction_costs;
