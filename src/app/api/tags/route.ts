import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings';
import { getErrorMessage } from '@/lib/rag';

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await getUserSettings(userId);
    const overrideHost = req.nextUrl.searchParams.get('host');
    const ollamaHost = overrideHost ? normalizeOllamaHost(overrideHost) : settings.ollamaHost;

    const response = await fetch(`${ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: text || 'Failed to fetch models. Is Ollama running?' }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to fetch models. Is Ollama running?') }, { status: 500 });
  }
}
