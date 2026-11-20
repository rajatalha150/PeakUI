-- Keep keyword retrieval in PostgreSQL as the Knowledge Base grows. Building
-- concurrently leaves existing searches and uploads available during rollout.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DocumentChunk_content_fts_idx"
  ON "DocumentChunk" USING GIN (to_tsvector('english', content));
