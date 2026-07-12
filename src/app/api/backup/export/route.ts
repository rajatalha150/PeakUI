import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentAuth } from "@/lib/request-auth";
import { streamBackupToArchive, type BackupScope } from "@/lib/backup-engine";
import * as archiver from "archiver";
import { PassThrough } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseScopes(searchParams: URLSearchParams): BackupScope[] {
  const raw = searchParams.get("scopes");
  if (!raw) return ["chats", "settings", "knowledgeBase"];
  const values = raw.split(",").map(s => s.trim().toLowerCase());
  const valid: BackupScope[] = [];
  for (const v of values) {
    if (v === "chats" || v === "settings" || v === "knowledgebase") {
      valid.push(v === "knowledgebase" ? "knowledgeBase" : (v as BackupScope));
    }
  }
  return valid.length > 0 ? valid : ["chats", "settings", "knowledgeBase"];
}

export async function GET(req: Request) {
  try {
    const auth = await getCurrentAuth();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const scopes = parseScopes(url.searchParams);
    const progressId = url.searchParams.get("progressId") ?? randomUUID();
    const username = auth.user.username.replace(/[^a-z0-9_-]/gi, "_");
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `peakui-backup-${username}-${date}.zip`;

    const archive = (archiver as unknown as (format: string, options?: Record<string, unknown>) => archiver.Archiver)("zip", { zlib: { level: 6 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Kick off archive population in the background; errors are captured in progress
    void streamBackupToArchive({
      userId: auth.user.id,
      username: auth.user.username,
      scopes,
      progressId,
      archive,
    });

    return new NextResponse(passThrough as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Backup-Progress-Id": progressId,
      },
    });
  } catch (error) {
    console.error("Backup export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
