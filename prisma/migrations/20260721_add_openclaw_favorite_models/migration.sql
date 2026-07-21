-- Persist per-user favorite (starred) models server-side so they follow the
-- user across browsers/devices instead of living only in localStorage.
-- Stored as a JSON-encoded array of `provider:modelName` keys.
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "openClawFavoriteModels" TEXT NOT NULL DEFAULT '[]';