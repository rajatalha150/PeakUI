ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexingJobId" TEXT UNIQUE;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexingProgress" INTEGER DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexingAttempts" INTEGER DEFAULT 0;

-- Widen vector column to canonical dimension. Dropping + re-adding is required because
-- pgvector does not support ALTER COLUMN on vector dimensions.
ALTER TABLE "DocumentChunk" DROP COLUMN IF EXISTS "vector";
ALTER TABLE "DocumentChunk" ADD COLUMN "vector" vector(1536);
CREATE INDEX IF NOT EXISTS "DocumentChunk_vector_idx" ON "DocumentChunk" USING hnsw ("vector" vector_cosine_ops);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
