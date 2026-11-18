import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserIdWithPermission } from '@/lib/request-auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const requestedOffset = Number(new URL(req.url).searchParams.get('offset') || 0);
    const offset = Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const limit = 100;
    const document = await prisma.document.findFirst({
      where: { id, userId },
      omit: { originalContent: true },
      include: {
        _count: { select: { chunks: true } },
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          skip: offset,
          take: limit,
          select: {
            id: true,
            chunkIndex: true,
            content: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { chunks, ...documentMeta } = document;
    const content = chunks.map(chunk => chunk.content).join('\n\n');

    return NextResponse.json({
      document: documentMeta,
      retrievalScope: document._count.chunks === 1 ? 'full-document' : 'chunked',
      content,
      chunks,
      offset,
      nextOffset: offset + chunks.length < document._count.chunks ? offset + chunks.length : null,
    });
  } catch (error) {
    console.error('RAG document fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
