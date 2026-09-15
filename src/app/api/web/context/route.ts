import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { buildWebContext } from '@/lib/web-context';
import { getErrorMessage } from '@/lib/rag';
import { getUserSettings } from '@/lib/settings';

export const runtime = 'nodejs';

interface WebContextBody {
  query?: unknown
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as WebContextBody;
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const settings = await getUserSettings(userId);
    const result = await buildWebContext(query, {
      signal: req.signal,
      firecrawlApiKey: settings.firecrawlApiKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Web context error:', error);
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to retrieve web context') }, { status: 500 });
  }
}
