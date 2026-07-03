-- Add user-configurable tool-step cap for WorkSpaces single-turn loop
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawMaxToolRoundsPerTurn" INTEGER NOT NULL DEFAULT 25;
