import { NextResponse } from 'next/server';
import { branchChatSession } from '@/lib/chat-sessions';
import { getCurrentUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const body = await req.json().catch(() => ({})) as {
      messageId?: unknown;
      branchLabel?: unknown;
    };

    const session = await branchChatSession(userId, {
      sessionId: id,
      messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
      branchLabel: typeof body.branchLabel === 'string' ? body.branchLabel : undefined,
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, session }, { status: 201 });
  } catch (error) {
    console.error('Failed to branch chat session:', error);
    if (error instanceof Error && error.message === 'Branch point message not found') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
