import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserIdWithPermission } from '@/lib/request-auth';

export async function GET(_req: Request, context: RouteContext<'/api/rag/documents/[id]'>) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const document = await prisma.document.findFirst({
      where: { id, userId },
      include: {
        _count: { select: { chunks: true } },
        chunks: {
          orderBy: { chunkIndex: 'asc' },
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
      retrievalScope: chunks.length === 1 ? 'full-document' : 'chunked',
      content,
      chunks,
    });
  } catch (error) {
    console.error('RAG document fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
