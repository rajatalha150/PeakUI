import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings, normalizeOpenClawProvider } from '@/lib/settings';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

interface ModelResult {
  name: string;
  model: string;
  [key: string]: unknown;
}

function normalizeProvider(value: unknown) {
  return normalizeOpenClawProvider(value);
}

function normalizeModelName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return url.origin;
  } catch {
    return defaultValue;
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await getUserSettings(userId);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const provider = normalizeProvider(body.provider ?? settings.openClawProvider);
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
        return NextResponse.json({ error: text || 'Failed to fetch models' }, { status: response.status });
      }

      const data = await response.json().catch(() => ({}));
      const openAIModels = Array.isArray(data?.data) ? (data.data as Record<string, unknown>[]) : [];
      const fallbackModels = Array.isArray(data?.models) ? (data.models as Record<string, unknown>[]) : [];
      const models = openAIModels.length > 0
        ? openAIModels.map((item): ModelResult | null => {
            const name = normalizeModelName(item.id ?? item.name);
            if (!name) return null;
            return { ...item, name, model: name };
          }).filter((model: ModelResult | null): model is ModelResult => Boolean(model))
        : fallbackModels.map((item): ModelResult | null => {
            const name = normalizeModelName(item.id ?? item.name);
            if (!name) return null;
            return { ...item, name, model: name };
          }).filter((model: ModelResult | null): model is ModelResult => Boolean(model));

      return NextResponse.json({ provider, models });
    }

    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: text || 'Failed to fetch models' }, { status: response.status });
    }

    const data = await response.json().catch(() => ({}));
    const rawModels = Array.isArray(data?.models) ? (data.models as Record<string, unknown>[]) : [];
    const models = rawModels.map((item): ModelResult | null => {
      const name = normalizeModelName(item.name ?? item.model);
      if (!name) return null;
      return { ...item, name, model: name };
    }).filter((model: ModelResult | null): model is ModelResult => Boolean(model));

    return NextResponse.json({ provider, models });
  } catch (error) {
    console.error('Open Claw model lookup failed:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
