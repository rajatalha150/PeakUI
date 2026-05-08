import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings, normalizeOpenClawProvider, normalizeOllamaHost } from '@/lib/settings';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

function normalizeProviderBaseUrl(value: unknown, provider: 'ollama' | 'openai-compatible', fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const defaultValue = provider === 'openai-compatible'
    ? DEFAULT_OPENAI_COMPATIBLE_BASE_URL
    : fallback;

  if (!raw) return defaultValue;

  if (provider === 'openai-compatible') {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const pathname = url.pathname.replace(/\/$/, '');
      if (!pathname || pathname === '/') return `${url.origin}/v1`;
      return `${url.origin}${pathname.endsWith('/v1') ? pathname : `${pathname}/v1`}`;
    } catch {
      const trimmed = raw.replace(/\/$/, '');
      return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
    }
  }

  return normalizeOllamaHost(raw || fallback);
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await getUserSettings(userId);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const provider = normalizeOpenClawProvider(body.provider ?? settings.openClawProvider);
    const baseUrl = normalizeProviderBaseUrl(
      body.baseUrl ?? body.base_url ?? (provider === 'openai-compatible' ? settings.openClawBaseUrl : settings.ollamaHost),
      provider,
      provider === 'openai-compatible' ? settings.openClawBaseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL : settings.ollamaHost,
    ) || (provider === 'openai-compatible' ? DEFAULT_OPENAI_COMPATIBLE_BASE_URL : settings.ollamaHost);
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : typeof body.api_key === 'string' && body.api_key.trim()
        ? body.api_key.trim()
        : '';

    if (provider === 'openai-compatible') {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return NextResponse.json({ error: text || 'Failed to verify provider connection' }, { status: response.status });
      }

      const data = await response.json().catch(() => ({})) as {
        data?: unknown[];
        models?: unknown[];
      };
      const modelCount = Array.isArray(data.data) ? data.data.length : Array.isArray(data.models) ? data.models.length : 0;

      return NextResponse.json({
        ok: true,
        provider,
        baseUrl,
        modelCount,
      });
    }

    const [versionResponse, tagsResponse, psResponse] = await Promise.all([
      fetch(`${baseUrl}/api/version`),
      fetch(`${baseUrl}/api/tags`),
      fetch(`${baseUrl}/api/ps`),
    ]);

    if (!versionResponse.ok) {
      const text = await versionResponse.text();
      return NextResponse.json({ error: text || 'Failed to verify Ollama connection' }, { status: versionResponse.status });
    }

    if (!tagsResponse.ok) {
      const text = await tagsResponse.text();
      return NextResponse.json({ error: text || 'Failed to load Ollama models' }, { status: tagsResponse.status });
    }

    const versionData = await versionResponse.json().catch(() => ({})) as { version?: unknown };
    const tagsData = await tagsResponse.json().catch(() => ({})) as { models?: unknown[] };
    const psData = psResponse.ok
      ? await psResponse.json().catch(() => ({})) as { models?: unknown[] }
      : { models: [] };

    return NextResponse.json({
      ok: true,
      provider,
      baseUrl,
      version: typeof versionData.version === 'string' ? versionData.version : '',
      modelCount: Array.isArray(tagsData.models) ? tagsData.models.length : 0,
      loadedModelCount: Array.isArray(psData.models) ? psData.models.length : 0,
    });
  } catch (error) {
    console.error('Open Claw provider verification failed:', error);
    return NextResponse.json({ error: 'Failed to verify provider connection' }, { status: 500 });
  }
}
