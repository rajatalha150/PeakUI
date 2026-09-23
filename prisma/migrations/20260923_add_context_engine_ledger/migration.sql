-- Durable, source-linked context memory. The legacy ChatSession.messages JSON
-- column is retained so existing sessions remain fully backwards compatible.
CREATE TABLE IF NOT EXISTS "ContextEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContextEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContextEpisode" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "startOrdinal" INTEGER NOT NULL,
  "endOrdinal" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "searchText" TEXT NOT NULL,
  "tokenEstimate" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContextEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContextSnapshot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "episodeId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "model" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'working-memory',
  "summary" TEXT NOT NULL,
  "sourceStart" INTEGER NOT NULL,
  "sourceEnd" INTEGER NOT NULL,
  "tokenEstimate" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContextSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContextEvent_sessionId_ordinal_contentHash_key" ON "ContextEvent"("sessionId", "ordinal", "contentHash");
CREATE INDEX IF NOT EXISTS "ContextEvent_sessionId_ordinal_recordedAt_idx" ON "ContextEvent"("sessionId", "ordinal", "recordedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ContextEpisode_sessionId_startOrdinal_endOrdinal_key" ON "ContextEpisode"("sessionId", "startOrdinal", "endOrdinal");
CREATE INDEX IF NOT EXISTS "ContextEpisode_sessionId_updatedAt_idx" ON "ContextEpisode"("sessionId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ContextSnapshot_sessionId_createdAt_idx" ON "ContextSnapshot"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContextSnapshot_episodeId_idx" ON "ContextSnapshot"("episodeId");

ALTER TABLE "ContextEvent" ADD CONSTRAINT "ContextEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContextEpisode" ADD CONSTRAINT "ContextEpisode_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "ContextEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
