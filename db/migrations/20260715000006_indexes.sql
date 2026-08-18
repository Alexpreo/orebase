-- migrate:up
-- Hybrid retrieval indexes on document_chunks: HNSW (cosine) for vector search,
-- GIN over to_tsvector for keyword/full-text search.
CREATE INDEX document_chunks_embedding_hnsw
  ON raw.document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX document_chunks_content_fts
  ON raw.document_chunks USING gin (to_tsvector('english', content));

-- Foreign-key / lookup indexes (Postgres does not auto-index FK columns).
CREATE INDEX documents_company_id_idx      ON raw.documents (company_id);
CREATE INDEX documents_project_id_idx      ON raw.documents (project_id);
CREATE INDEX documents_status_idx          ON raw.documents (status);
CREATE INDEX documents_source_idx          ON raw.documents (source);
CREATE INDEX documents_external_id_idx     ON raw.documents (external_id);

CREATE INDEX document_chunks_document_id_idx ON raw.document_chunks (document_id);

-- Supports the SELECT ... FOR UPDATE SKIP LOCKED job claim (filter by status/type, order by age).
CREATE INDEX processing_jobs_claim_idx
  ON raw.processing_jobs (status, job_type, created_at);
CREATE INDEX processing_jobs_document_id_idx ON raw.processing_jobs (document_id);

CREATE INDEX sedar_issuers_company_id_idx  ON sedar.sedar_issuers (company_id);
CREATE INDEX pending_fetches_status_idx    ON sedar.pending_fetches (status);

CREATE INDEX projects_company_id_idx           ON core.projects (company_id);
CREATE INDEX resource_estimates_project_id_idx ON core.resource_estimates (project_id);
CREATE INDEX resource_estimates_document_id_idx ON core.resource_estimates (document_id);
CREATE INDEX drill_results_project_id_idx      ON core.drill_results (project_id);
CREATE INDEX drill_results_document_id_idx     ON core.drill_results (document_id);
CREATE INDEX project_economics_project_id_idx  ON core.project_economics (project_id);
CREATE INDEX project_economics_document_id_idx ON core.project_economics (document_id);
CREATE INDEX document_qps_qp_id_idx            ON core.document_qps (qp_id);
CREATE INDEX project_events_project_id_idx     ON core.project_events (project_id);
CREATE INDEX project_events_document_id_idx    ON core.project_events (document_id);

CREATE INDEX chats_user_id_idx           ON app.chats (user_id);
CREATE INDEX chat_messages_chat_id_idx   ON app.chat_messages (chat_id);
CREATE INDEX watchlists_user_id_idx      ON app.watchlists (user_id);
CREATE INDEX watchlist_items_watchlist_id_idx ON app.watchlist_items (watchlist_id);
CREATE INDEX watchlist_items_project_id_idx   ON app.watchlist_items (project_id);
CREATE INDEX watchlist_items_company_id_idx   ON app.watchlist_items (company_id);
CREATE INDEX alerts_user_id_idx          ON app.alerts (user_id);

-- migrate:down
DROP INDEX IF EXISTS app.alerts_user_id_idx;
DROP INDEX IF EXISTS app.watchlist_items_company_id_idx;
DROP INDEX IF EXISTS app.watchlist_items_project_id_idx;
DROP INDEX IF EXISTS app.watchlist_items_watchlist_id_idx;
DROP INDEX IF EXISTS app.watchlists_user_id_idx;
DROP INDEX IF EXISTS app.chat_messages_chat_id_idx;
DROP INDEX IF EXISTS app.chats_user_id_idx;

DROP INDEX IF EXISTS core.project_events_document_id_idx;
DROP INDEX IF EXISTS core.project_events_project_id_idx;
DROP INDEX IF EXISTS core.document_qps_qp_id_idx;
DROP INDEX IF EXISTS core.project_economics_document_id_idx;
DROP INDEX IF EXISTS core.project_economics_project_id_idx;
DROP INDEX IF EXISTS core.drill_results_document_id_idx;
DROP INDEX IF EXISTS core.drill_results_project_id_idx;
DROP INDEX IF EXISTS core.resource_estimates_document_id_idx;
DROP INDEX IF EXISTS core.resource_estimates_project_id_idx;
DROP INDEX IF EXISTS core.projects_company_id_idx;

DROP INDEX IF EXISTS sedar.pending_fetches_status_idx;
DROP INDEX IF EXISTS sedar.sedar_issuers_company_id_idx;

DROP INDEX IF EXISTS raw.processing_jobs_document_id_idx;
DROP INDEX IF EXISTS raw.processing_jobs_claim_idx;
DROP INDEX IF EXISTS raw.document_chunks_document_id_idx;
DROP INDEX IF EXISTS raw.documents_external_id_idx;
DROP INDEX IF EXISTS raw.documents_source_idx;
DROP INDEX IF EXISTS raw.documents_status_idx;
DROP INDEX IF EXISTS raw.documents_project_id_idx;
DROP INDEX IF EXISTS raw.documents_company_id_idx;
DROP INDEX IF EXISTS raw.document_chunks_content_fts;
DROP INDEX IF EXISTS raw.document_chunks_embedding_hnsw;
