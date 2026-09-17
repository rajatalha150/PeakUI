import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { deleteChatSession, deleteChatSessions, listChatSessions, updateChatSession, upsertChatSession } from '@/lib/chat-sessions';

export const runtime = 'nodejs';

function normalizeSurface(value: string | null): 'chat' | 'workspace-tool' | 'coder' {
  if (value === 'workspace-tool') return 'workspace-tool';
  if (value === 'coder') return 'coder';
  return 'chat';
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
      surface: body.surface === 'workspace-tool' ? 'workspace-tool' : body.surface === 'coder' ? 'coder' : 'chat',
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
      surface: body.surface === 'workspace-tool' ? 'workspace-tool' : body.surface === 'coder' ? 'coder' : 'chat',
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
    const surface = body.surface === 'workspace-tool' ? 'workspace-tool' : body.surface === 'coder' ? 'coder' : body.surface === 'chat' ? 'chat' : undefined;

    // A specific id (or list of ids) is always the precise intent and MUST win
    // over a `surface` that happens to ride along. The Coding view sends both
    // `{ id, surface: 'coder' }` when deleting a single session, and the old
    // ordering interpreted that as "delete every coder session" — one click
    // wiped the whole surface, and the transcript poll then re-persisted the
    // still-open sessions as zombies that "kept popping back".
    if (ids.length > 0) {
      const result = await deleteChatSessions(userId, { ids });
      return NextResponse.json({ success: true, count: result.count });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (id) {
      const deleted = await deleteChatSession(userId, id);
      if (!deleted) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, count: 1 });
    }

    // Only a bare surface (no id at all) means "clear the whole surface".
    if (surface) {
      const result = await deleteChatSessions(userId, { surface });
      return NextResponse.json({ success: true, count: result.count });
    }

    return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to delete chat:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
