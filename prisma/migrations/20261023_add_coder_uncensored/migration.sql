-- Add the Coder "uncensored mode" toggle. Default false: the normal Coder
-- brain is untouched unless the user explicitly enables it.
ALTER TABLE "UserSettings" ADD COLUMN "coderUncensored" BOOLEAN NOT NULL DEFAULT false;
