-- Persist per-turn Knowledge Base (RAG) draft to ChatSession so reopened
-- chats can re-hydrate the search text and citation set as a pending draft.
ALTER TABLE "ChatSession"
  ADD COLUMN "ragEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ragQuery" TEXT,
  ADD COLUMN "ragSourcesJson" TEXT;
