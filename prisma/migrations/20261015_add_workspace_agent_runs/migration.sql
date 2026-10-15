CREATE TABLE "WorkspaceAgentRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "workspaceId" TEXT,
  "requestJson" TEXT NOT NULL,
  "secretsCiphertext" TEXT,
  "persistedJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "model" TEXT NOT NULL DEFAULT '',
  "assistantJson" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WorkspaceAgentRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceAgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WorkspaceAgentRunEvent" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "payload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceAgentRunEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceAgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkspaceAgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspaceAgentRunEvent_runId_sequence_key" ON "WorkspaceAgentRunEvent"("runId", "sequence");
CREATE UNIQUE INDEX "WorkspaceAgentRun_idempotencyKey_key" ON "WorkspaceAgentRun"("idempotencyKey");
CREATE INDEX "WorkspaceAgentRun_userId_chatId_createdAt_idx" ON "WorkspaceAgentRun"("userId", "chatId", "createdAt");
CREATE INDEX "WorkspaceAgentRun_status_createdAt_idx" ON "WorkspaceAgentRun"("status", "createdAt");
CREATE INDEX "WorkspaceAgentRunEvent_runId_createdAt_idx" ON "WorkspaceAgentRunEvent"("runId", "createdAt");
