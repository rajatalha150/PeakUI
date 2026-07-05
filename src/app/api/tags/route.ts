import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings';
import { getErrorMessage } from '@/lib/rag';

const DEFAULT_OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';

function resolveOllamaBaseUrl(settings: Awaited<ReturnType<typeof getUserSettings>>, overrideHost?: string | null): { baseUrl: string; apiKey: string } {
  if (settings.ollamaUseCloudApi) {
    return { baseUrl: DEFAULT_OLLAMA_CLOUD_BASE_URL, apiKey: settings.ollamaApiKey }
  }
  const ollamaHost = overrideHost ? normalizeOllamaHost(overrideHost) : settings.ollamaHost
  return { baseUrl: ollamaHost, apiKey: '' }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await getUserSettings(userId);
    const overrideHost = req.nextUrl.searchParams.get('host');
    const { baseUrl: ollamaHost, apiKey } = resolveOllamaBaseUrl(settings, overrideHost);

    const response = await fetch(`${ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(apiKey.trim() ? { Authorization: 'Bearer ' + apiKey.trim() } : {}),
      },
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
