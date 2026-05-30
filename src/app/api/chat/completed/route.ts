import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { finalizeChatSession } from '@/lib/chat-sessions';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const chatId = typeof body.chat_id === 'string' && body.chat_id.trim()
      ? body.chat_id.trim()
      : typeof body.chatId === 'string' && body.chatId.trim()
        ? body.chatId.trim()
        : '';
    const message = body.message ?? null;
    const messages = body.messages ?? undefined;
    const messageId = typeof body.id === 'string' && body.id.trim()
      ? body.id.trim()
      : typeof body.message_id === 'string' && body.message_id.trim()
        ? body.message_id.trim()
        : undefined;
    const title = typeof body.title === 'string' ? body.title : undefined;
    const surface = body.surface === 'openclaw' ? 'openclaw' : 'chat';

    if (!chatId) {
      return NextResponse.json({ error: 'Chat ID is required' }, { status: 400 });
    }

    const session = await finalizeChatSession(userId, {
      chatId,
      messageId,
      message,
      messages,
      title,
      surface,
      autoContinueMode: body.autoContinueMode,
      autoContinueMaxSteps: body.autoContinueMaxSteps,
      branchLabel: body.branchLabel,
      lastAutoContinueAt: body.lastAutoContinueAt,
    });

    if (!session) {
      return NextResponse.json({ error: 'Could not finalize chat' }, { status: 404 });
    }

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error('Failed to finalize chat:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
