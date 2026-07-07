-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add new columns to Document table
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "embeddingDimensions" INTEGER;

-- Add new columns to DocumentChunk table
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "vector" vector(1536);
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS "Document_userId_status_idx" ON "Document"("userId", "status");
