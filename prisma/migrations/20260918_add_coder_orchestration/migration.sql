-- Multi-model orchestration: dedicated vision + writer delegate models for the
-- Coding surface. `coderModel` remains the planner/executor; `coderVisionModel`
-- maps to the daemon's vision bridge, `coderWriterModel` materialises a
-- writer subagent pinned to that model. Empty = no delegation (fall back to the
-- main model / auto-pick).

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderVisionModel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "coderWriterModel" TEXT NOT NULL DEFAULT '';
