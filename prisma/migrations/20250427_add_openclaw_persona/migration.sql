-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaTemplate" TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaTone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaExpertise" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaBoundaries" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawPersonaOperatingInstructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawUserProfileName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawUserProfileRole" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawUserProfilePreferences" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawUserProfileContext" TEXT NOT NULL DEFAULT '';
