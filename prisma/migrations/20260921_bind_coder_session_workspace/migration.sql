-- Bind each Coding session to the workspace it was created against, so a later
-- reattach restores the ORIGINAL project even if the user's default coder
-- workspace preference has since changed. Nullable: legacy sessions created
-- before this column have no recorded binding and are conservatively rebound to
-- the current default on their next daemon-session create/load.

ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "coderWorkspace" TEXT;
