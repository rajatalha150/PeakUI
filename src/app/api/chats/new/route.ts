import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { upsertChatSession } from '@/lib/chat-sessions';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const sessionId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    const title = typeof body.title === 'string' ? body.title : undefined;
    const messages = body.messages;
    const pinned = typeof body.pinned === 'boolean' ? body.pinned : undefined;
    const surface = body.surface === 'openclaw' ? 'openclaw' : 'chat';

    const result = await upsertChatSession(userId, {
      id: sessionId,
      title,
      messages,
      pinned,
      surface,
      autoContinueMode: body.autoContinueMode,
      autoContinueMaxSteps: body.autoContinueMaxSteps,
      branchLabel: body.branchLabel,
      ragEnabled: typeof body.ragEnabled === 'boolean' ? body.ragEnabled : undefined,
      ragQuery: typeof body.ragQuery === 'string' ? body.ragQuery : (body.ragQuery === null ? null : undefined),
      ragSources: Array.isArray(body.ragSources) ? body.ragSources : undefined,
    });

    return NextResponse.json({ success: true, session: result.session }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error('Failed to create chat:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
