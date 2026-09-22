CREATE TABLE "GitHubConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "githubLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoderProject" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "githubConnectionId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'github',
  "repositoryId" TEXT NOT NULL,
  "repositoryFullName" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "workspacePath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoderProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubConnection_installationId_key" ON "GitHubConnection"("installationId");
CREATE INDEX "GitHubConnection_userId_updatedAt_idx" ON "GitHubConnection"("userId", "updatedAt");
CREATE UNIQUE INDEX "CoderProject_workspacePath_key" ON "CoderProject"("workspacePath");
CREATE UNIQUE INDEX "CoderProject_userId_provider_repositoryId_branch_key" ON "CoderProject"("userId", "provider", "repositoryId", "branch");
CREATE INDEX "CoderProject_userId_updatedAt_idx" ON "CoderProject"("userId", "updatedAt");

ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoderProject" ADD CONSTRAINT "CoderProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoderProject" ADD CONSTRAINT "CoderProject_githubConnectionId_fkey" FOREIGN KEY ("githubConnectionId") REFERENCES "GitHubConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
