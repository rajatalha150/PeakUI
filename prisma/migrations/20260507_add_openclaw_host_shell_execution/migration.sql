ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "shellExecutionTarget" TEXT NOT NULL DEFAULT 'container';

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "shellHostAllowedRoots" TEXT NOT NULL DEFAULT '/tmp/viewllama-openclaw-workspace';

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "shellHostAllowedEnvVars" TEXT NOT NULL DEFAULT E'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM';

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "shellHostMaxTimeoutMs" INTEGER NOT NULL DEFAULT 60000;

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "shellHostMaxOutputBytes" INTEGER NOT NULL DEFAULT 262144;

CREATE TABLE IF NOT EXISTS "ShellCommandAudit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "messageId" TEXT,
  "command" TEXT NOT NULL,
  "description" TEXT,
  "cwd" TEXT,
  "target" TEXT NOT NULL DEFAULT 'container',
  "approvalMode" TEXT NOT NULL DEFAULT 'ask-first',
  "status" TEXT NOT NULL DEFAULT 'requested',
  "autoApproved" BOOLEAN NOT NULL DEFAULT false,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
  "outputLimitBytes" INTEGER NOT NULL DEFAULT 262144,
  "allowedRoots" TEXT NOT NULL DEFAULT '',
  "allowedEnvVars" TEXT NOT NULL DEFAULT '',
  "stdout" TEXT NOT NULL DEFAULT '',
  "stderr" TEXT NOT NULL DEFAULT '',
  "exitCode" INTEGER,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShellCommandAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShellCommandAudit_userId_createdAt_idx"
  ON "ShellCommandAudit"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "ShellCommandAudit_sessionId_idx"
  ON "ShellCommandAudit"("sessionId");

CREATE INDEX IF NOT EXISTS "ShellCommandAudit_status_idx"
  ON "ShellCommandAudit"("status");

CREATE INDEX IF NOT EXISTS "ShellCommandAudit_target_idx"
  ON "ShellCommandAudit"("target");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ShellCommandAudit_userId_fkey'
      AND table_name = 'ShellCommandAudit'
  ) THEN
    ALTER TABLE "ShellCommandAudit"
      ADD CONSTRAINT "ShellCommandAudit_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
