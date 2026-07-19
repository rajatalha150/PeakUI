import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getChatSessionById } from '@/lib/chat-sessions';

export const runtime = 'nodejs';

// Returns the full session DTO (including the `messages` transcript) for a
// single WorkSpaces/chat session. The list endpoint (`GET /api/chats`) now
// projects the heavy `messages` column out for sidebar rendering, so the
// active session's transcript is fetched lazily through this route when a
// session is opened or switched to.
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Session ID required' }, { status: 400 });

    const session = await getChatSessionById(userId, id);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(session);
  } catch (error) {
    console.error('Failed to fetch chat session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}