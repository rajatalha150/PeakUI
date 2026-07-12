import { NextResponse } from "next/server";
import { getBackupProgress } from "@/lib/backup-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing progress id" }, { status: 400 });
    }

    const progress = getBackupProgress(id);
    if (!progress) {
      return NextResponse.json({ error: "Progress not found" }, { status: 404 });
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error("Backup progress error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
