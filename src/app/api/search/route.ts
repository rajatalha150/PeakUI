import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const query = url.searchParams.get('q') || '';
    const surface = url.searchParams.get('surface') || 'chat';

    if (!query.trim()) {
      return NextResponse.json([]);
    }

    // Search in session titles
    const sessions = await prisma.chatSession.findMany({
      where: {
        userId,
        surface: surface === 'openclaw' ? 'openclaw' : 'chat',
        title: {
          contains: query,
          mode: 'insensitive',
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    // Also search in messages content
    const messageMatches = await prisma.chatSession.findMany({
      where: {
        userId,
        surface: surface === 'openclaw' ? 'openclaw' : 'chat',
        messages: {
          contains: query,
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    // Merge and deduplicate results
    const sessionMap = new Map();
    for (const session of [...sessions, ...messageMatches]) {
      if (!sessionMap.has(session.id)) {
        sessionMap.set(session.id, {
          id: session.id,
          title: session.title,
          pinned: session.pinned,
          surface: session.surface,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          folderId: session.folderId,
          tags: session.tags.map((t: { tag: { id: string; name: string; color: string } }) => ({
            id: t.tag.id,
            name: t.tag.name,
            color: t.tag.color,
          })),
          matchType: session.title.toLowerCase().includes(query.toLowerCase()) ? 'title' : 'content',
        });
      }
    }

    const results = Array.from(sessionMap.values());
    
    // Sort: pinned first, then by match type (title matches first), then by updatedAt
    results.sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      if (a.matchType !== b.matchType) return a.matchType === 'title' ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return NextResponse.json(results.slice(0, 50));
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
