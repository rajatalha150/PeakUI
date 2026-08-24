-- Rename openClaw* settings columns to workspaceTool* (generic tool name).
-- Data is preserved via ALTER TABLE ... RENAME COLUMN.
ALTER TABLE "UserSettings" RENAME COLUMN "openClawProvider" TO "workspaceToolProvider";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawModel" TO "workspaceToolModel";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPromptTier" TO "workspaceToolPromptTier";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawBaseUrl" TO "workspaceToolBaseUrl";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaTemplate" TO "workspaceToolPersonaTemplate";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaName" TO "workspaceToolPersonaName";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaTone" TO "workspaceToolPersonaTone";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaExpertise" TO "workspaceToolPersonaExpertise";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaBoundaries" TO "workspaceToolPersonaBoundaries";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawPersonaOperatingInstructions" TO "workspaceToolPersonaOperatingInstructions";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUserProfileName" TO "workspaceToolUserProfileName";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUserProfileRole" TO "workspaceToolUserProfileRole";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUserProfilePreferences" TO "workspaceToolUserProfilePreferences";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUserProfileContext" TO "workspaceToolUserProfileContext";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawFileAccessMode" TO "workspaceToolFileAccessMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAllowedPaths" TO "workspaceToolAllowedPaths";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawFileWriteMode" TO "workspaceToolFileWriteMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawWritablePaths" TO "workspaceToolWritablePaths";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawHostAccessMode" TO "workspaceToolHostAccessMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawWorkspaceHostRoot" TO "workspaceToolWorkspaceHostRoot";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawCodeExecutionMode" TO "workspaceToolCodeExecutionMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawBrowserMode" TO "workspaceToolBrowserMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUwafBrowserMode" TO "workspaceToolUwafBrowserMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUwafScreenshots" TO "workspaceToolUwafScreenshots";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUwafDefaultMode" TO "workspaceToolUwafDefaultMode";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawUwafLiveBrowser" TO "workspaceToolUwafLiveBrowser";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAutomationExecutionEnabled" TO "workspaceToolAutomationExecutionEnabled";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAutomationExecutionModel" TO "workspaceToolAutomationExecutionModel";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAutomationExecutionMaxRunsPerHour" TO "workspaceToolAutomationExecutionMaxRunsPerHour";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAutomationExecutionAttachWorkspace" TO "workspaceToolAutomationExecutionAttachWorkspace";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawAutomationExecutionAttachMemory" TO "workspaceToolAutomationExecutionAttachMemory";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionAutoContinueDefault" TO "workspaceToolSessionAutoContinueDefault";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionAutoContinueMaxSteps" TO "workspaceToolSessionAutoContinueMaxSteps";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionSummariesEnabled" TO "workspaceToolSessionSummariesEnabled";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionSummaryTargetTokens" TO "workspaceToolSessionSummaryTargetTokens";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionPreserveTurns" TO "workspaceToolSessionPreserveTurns";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionAnalyticsEnabled" TO "workspaceToolSessionAnalyticsEnabled";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawSessionBranchingEnabled" TO "workspaceToolSessionBranchingEnabled";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawMaxToolRoundsPerTurn" TO "workspaceToolMaxToolRoundsPerTurn";
ALTER TABLE "UserSettings" RENAME COLUMN "openClawFavoriteModels" TO "workspaceToolFavoriteModels";

-- Rename the chat-session surface discriminator value.
UPDATE "ChatSession" SET "surface" = 'workspace-tool' WHERE "surface" = 'openclaw';

