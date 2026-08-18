-- migrate:up
-- company_id / project_id reference core.* which is created in a later migration;
-- those foreign keys are added there via ALTER TABLE to avoid a schema ordering cycle.
CREATE TABLE raw.documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,                       -- 'edgar' | 'sedar' | 'asx' | 'newswire' | 'manual'
  source_url   text,
  external_id  text,
  company_id   uuid,
  project_id   uuid,
  doc_type     text,                                -- 'ni43101' | 'sk1300' | 'jorc' | 'pea' | 'pfs' | 'fs' | ...
  title        text,
  filed_at     date,
  sha256       text UNIQUE,                          -- dedupe on hash
  storage_path text,
  page_count   int,
  status       text NOT NULL DEFAULT 'ingested',     -- ingested -> parsed -> indexed -> extracted | failed
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw.document_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES raw.documents(id) ON DELETE CASCADE,
  chunk_index   int NOT NULL,
  page_start    int,
  page_end      int,
  content       text NOT NULL,
  section_title text,
  embedding     vector(1024)
);

CREATE TABLE raw.processing_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES raw.documents(id) ON DELETE CASCADE,
  job_type    text NOT NULL,                         -- parse | chunk | embed | extract
  status      text NOT NULL DEFAULT 'pending',       -- pending | running | done | failed
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS raw.processing_jobs;
DROP TABLE IF EXISTS raw.document_chunks;
DROP TABLE IF EXISTS raw.documents;
