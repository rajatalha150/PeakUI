import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { deleteChatSession, deleteChatSessions, listChatSessions, updateChatSession, upsertChatSession } from '@/lib/chat-sessions';

export const runtime = 'nodejs';

function normalizeSurface(value: string | null): 'chat' | 'openclaw' {
  return value === 'openclaw' ? 'openclaw' : 'chat';
}

export async function GET(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const surface = normalizeSurface(url.searchParams.get('surface'));
    const folderId = url.searchParams.get('folderId');
    
    const sessions = await listChatSessions(
      userId, 
      surface,
      folderId === null ? undefined : (folderId || undefined)
    );
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Failed to fetch chats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const result = await upsertChatSession(userId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      messages: body.messages,
      pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
      surface: body.surface === 'openclaw' ? 'openclaw' : 'chat',
      autoContinueMode: body.autoContinueMode,
      autoContinueMaxSteps: body.autoContinueMaxSteps,
      branchLabel: body.branchLabel,
      lastAutoContinueAt: body.lastAutoContinueAt,
      ragEnabled: typeof body.ragEnabled === 'boolean' ? body.ragEnabled : undefined,
      ragQuery: typeof body.ragQuery === 'string' ? body.ragQuery : (body.ragQuery === null ? null : undefined),
      ragSources: Array.isArray(body.ragSources) ? body.ragSources : undefined,
      clearContextSummary: body.clearContextSummary === true,
      refreshContextSummary: body.refreshContextSummary === true,
    });

    return NextResponse.json({ success: true, session: result.session }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error('Failed to save chat:', error);

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'Session ID required' }, { status: 400 });

    const session = await updateChatSession(userId, id, {
      title: typeof body.title === 'string' ? body.title : undefined,
      pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
      messages: body.messages,
      surface: body.surface === 'openclaw' ? 'openclaw' : 'chat',
      folderId: body.folderId !== undefined ? (body.folderId === null ? null : body.folderId) : undefined,
      autoContinueMode: body.autoContinueMode,
      autoContinueMaxSteps: body.autoContinueMaxSteps,
      branchLabel: body.branchLabel,
      lastAutoContinueAt: body.lastAutoContinueAt,
      ragEnabled: typeof body.ragEnabled === 'boolean' ? body.ragEnabled : undefined,
      ragQuery: typeof body.ragQuery === 'string' ? body.ragQuery : (body.ragQuery === null ? null : undefined),
      ragSources: Array.isArray(body.ragSources) ? body.ragSources : undefined,
      clearContextSummary: body.clearContextSummary === true,
      refreshContextSummary: body.refreshContextSummary === true,
    });

    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error('Failed to update chat:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const surface = body.surface === 'openclaw' ? 'openclaw' : body.surface === 'chat' ? 'chat' : undefined;

    if (ids.length > 0 || surface) {
      const result = await deleteChatSessions(userId, { ids, surface });
      return NextResponse.json({ success: true, count: result.count });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'Session ID required' }, { status: 400 });

    const deleted = await deleteChatSession(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete chat:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
