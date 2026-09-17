-- Coding environment (Qwen Code daemon) settings, persisted per user so the
-- model / approval mode / context knobs survive reloads and container restarts
-- instead of living only in transient daemon state.

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderModel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderBaseUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderApiKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderApprovalMode" TEXT NOT NULL DEFAULT 'yolo';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderContextLength" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderToolSearchThreshold" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderWorkspace" TEXT NOT NULL DEFAULT '/workspace';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderToolsEnabled" BOOLEAN NOT NULL DEFAULT true;
