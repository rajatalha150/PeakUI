-- Add durable Canvas artifact revision history.
CREATE TABLE "CanvasArtifactRevision" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "extension" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "previewKind" TEXT NOT NULL DEFAULT 'file',
    "previewSummary" TEXT,
    "previewWidth" INTEGER,
    "previewHeight" INTEGER,
    "contentHash" TEXT,
    "presentationType" TEXT NOT NULL DEFAULT 'auto',
    "bundleId" TEXT,
    "bundleName" TEXT,
    "bundleRole" TEXT,
    "exportTargets" TEXT NOT NULL DEFAULT '[]',
    "sourceArtifactId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasArtifactRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasArtifactRevision_artifactId_version_key" ON "CanvasArtifactRevision"("artifactId", "version");
CREATE INDEX "CanvasArtifactRevision_artifactId_createdAt_idx" ON "CanvasArtifactRevision"("artifactId", "createdAt");

ALTER TABLE "CanvasArtifactRevision"
  ADD CONSTRAINT "CanvasArtifactRevision_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "CanvasArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
