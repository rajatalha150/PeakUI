import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentAuth } from "@/lib/request-auth";
import { importBackupData, type BackupData, type BackupScope } from "@/lib/backup-engine";
import AdmZip from "adm-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 900;

export async function POST(req: Request) {
  try {
    const auth = await getCurrentAuth();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const reindex = form.get("reindexDocuments") === "true";
    const progressId = (form.get("progressId") as string | null) ?? randomUUID();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Backup file is required." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Backup file must be a .zip archive." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = new AdmZip(buffer);

    const backupEntry = zip.getEntry("backup.json");
    if (!backupEntry) {
      return NextResponse.json({ error: "Invalid backup file: backup.json not found." }, { status: 400 });
    }

    const rawBackup = JSON.parse(zip.readAsText(backupEntry)) as BackupData;
    const manifest = rawBackup.manifest;
    if (!manifest || !Array.isArray(manifest.scopes)) {
      return NextResponse.json({ error: "Invalid backup manifest." }, { status: 400 });
    }

    const data: BackupData = {
      manifest,
      settings: rawBackup.settings ?? null,
    };

    const sessionsEntry = zip.getEntry("sessions.json");
    if (sessionsEntry) {
      const sessionsPayload = JSON.parse(zip.readAsText(sessionsEntry)) as {
        folders?: BackupData["folders"];
        tags?: BackupData["tags"];
        sessions?: BackupData["sessions"];
      };
      data.folders = sessionsPayload.folders;
      data.tags = sessionsPayload.tags;
      data.sessions = sessionsPayload.sessions;
    }

    const kbEntry = zip.getEntry("knowledge-base/documents.json");
    if (kbEntry) {
      const kbPayload = JSON.parse(zip.readAsText(kbEntry)) as NonNullable<BackupData["knowledgeBase"]>;
      // Pull originalContent from file entries if present
      const docs = kbPayload.documents.map(d => {
        if (d.fileEntry) {
          const fileEntry = zip.getEntry(d.fileEntry);
          if (fileEntry) {
            return { ...d, originalContent: zip.readAsText(fileEntry) };
          }
        }
        return d;
      });
      data.knowledgeBase = { documents: docs };
    }

    const result = await importBackupData(auth.user.id, data, progressId, { reindexDocuments: reindex });

    return NextResponse.json({
      success: true,
      progressId,
      result,
    });
  } catch (error) {
    console.error("Backup import error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
