-- migrate:up
-- Lets the processor reuse the embedding of identical chunk text instead of paying Voyage
-- again (refiled/amended reports repeat whole sections). ~3 MB for 63K chunks.
CREATE INDEX document_chunks_content_md5 ON raw.document_chunks USING hash (md5(content));

-- migrate:down
DROP INDEX IF EXISTS raw.document_chunks_content_md5;
