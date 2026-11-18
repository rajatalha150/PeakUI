import { NextResponse } from "next/server";
import { getBackupProgress } from "@/lib/backup-engine";
import { getCurrentAuth } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await getCurrentAuth();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing progress id" }, { status: 400 });
    }

    const progress = getBackupProgress(id);
    if (!progress || progress.userId !== auth.user.id) {
      return NextResponse.json({ error: "Progress not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: progress.id,
      startedAt: progress.startedAt,
      phase: progress.phase,
      message: progress.message,
      percent: progress.percent,
      scopes: progress.scopes,
      direction: progress.direction,
      error: progress.error,
    });
  } catch (error) {
    console.error("Backup progress error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
