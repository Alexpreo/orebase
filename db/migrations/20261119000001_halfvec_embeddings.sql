-- migrate:up
-- Store voyage-4 embeddings as half-precision. Halves the vector TOAST and the HNSW index
-- (together ~87% of document_chunks) with the same 1024 dimensions and no re-embedding:
-- the cast rounds each float32 to float16. Retrieval checked before/after with
-- workers/scripts/eval_retrieval.py.
SET LOCAL maintenance_work_mem = '256MB';
DROP INDEX IF EXISTS raw.document_chunks_embedding_hnsw;
ALTER TABLE raw.document_chunks
  ALTER COLUMN embedding TYPE halfvec(1024) USING embedding::halfvec(1024);
CREATE INDEX document_chunks_embedding_hnsw
  ON raw.document_chunks USING hnsw (embedding halfvec_cosine_ops);

-- migrate:down
SET LOCAL maintenance_work_mem = '256MB';
DROP INDEX IF EXISTS raw.document_chunks_embedding_hnsw;
ALTER TABLE raw.document_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);
CREATE INDEX document_chunks_embedding_hnsw
  ON raw.document_chunks USING hnsw (embedding vector_cosine_ops);
