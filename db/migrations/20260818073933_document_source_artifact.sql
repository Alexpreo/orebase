-- migrate:up
-- EDGAR files SK-1300 technical report summaries as HTML exhibits, not PDFs. We keep the
-- original bytes as filed (canonical, and its <table> markup gives exact structure for
-- extraction) and render a PDF derivative that the viewer and page citations point at.
--
-- storage_path        -> the artifact chunks and page anchors refer to (PDF)
-- source_storage_path -> the bytes exactly as filed (HTML for rendered docs, else null)
--
-- Rendered PDFs must never be re-rendered: a different Chromium build repaginates and
-- would invalidate every stored page anchor. render_engine records what produced it.
ALTER TABLE raw.documents
  ADD COLUMN source_storage_path text,
  ADD COLUMN source_content_type text,
  ADD COLUMN render_engine       text;

-- migrate:down
ALTER TABLE raw.documents
  DROP COLUMN IF EXISTS render_engine,
  DROP COLUMN IF EXISTS source_content_type,
  DROP COLUMN IF EXISTS source_storage_path;
