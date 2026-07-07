import { NextResponse } from 'next/server';
import { getCurrentUserIdWithPermission } from '@/lib/request-auth';
import { getUserSettings } from '@/lib/settings';
import { getErrorMessage } from '@/lib/rag';
import { buildKnowledgeBaseContext } from '@/lib/rag-engine';

interface SearchBody {
  query?: string;
  topK?: number;
  filters?: import('@/lib/rag-engine').RagSearchFilters;
  filename?: string;
  folder?: string;
  extension?: string;
  fileKind?: import('@/lib/rag-engine').RagSearchFilters['fileKind'];
  documentId?: string;
}

function normalizeTopK(value: unknown): number {
  const parsed = Number(value);
  if (parsed === -1) return 10000;
  if (!Number.isFinite(parsed) || parsed < 1) return 5;
  return Math.min(200, Math.round(parsed));
}

function normalizeFilters(body: SearchBody): import('@/lib/rag-engine').RagSearchFilters | undefined {
  const filters = body.filters || {};
  const normalized: import('@/lib/rag-engine').RagSearchFilters = {
    filename: filters.filename?.trim() || body.filename?.trim() || undefined,
    folder: filters.folder?.trim() || body.folder?.trim() || undefined,
    extension: filters.extension?.trim().replace(/^\./, '').toLowerCase() || body.extension?.trim().replace(/^\./, '').toLowerCase() || undefined,
    fileKind: (filters.fileKind && filters.fileKind !== 'all' ? filters.fileKind : undefined) || (body.fileKind && body.fileKind !== 'all' ? body.fileKind : undefined),
    documentId: filters.documentId?.trim() || body.documentId?.trim() || undefined,
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as SearchBody;
    const cleanQuery = body.query?.trim();
    if (!cleanQuery) return NextResponse.json({ error: 'Query is required' }, { status: 400 });

    const settings = await getUserSettings(userId);
    const topK = normalizeTopK(body.topK);
    const filters = normalizeFilters(body);

    const result = await buildKnowledgeBaseContext(cleanQuery, userId, {
      topK,
      filters,
    });

    if (!result.searched) {
      return NextResponse.json([]);
    }

    return NextResponse.json(result.sources);
  } catch (error) {
    console.error('RAG search error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
