-- Prompt detail tier for the OpenClaw system prompt. 'auto' (default) detects
-- the tier from the model's parameter size and native context; a manual value
-- (minimal/compact/standard/full) overrides detection.
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPromptTier" TEXT NOT NULL DEFAULT 'auto';
