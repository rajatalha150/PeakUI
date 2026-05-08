import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings';
import { getEmbedding, getErrorMessage } from '@/lib/rag';
import { ollamaModelKey } from '@/lib/embedding-models';

interface TestEmbedBody {
  model?: string;
  host?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaPsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

const EMBED_TEST_TIMEOUT_MS = 30000;
const OLLAMA_PROBE_TIMEOUT_MS = 5000;

async function fetchOllamaJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status} for ${url}`);
  }
  return await res.json() as T;
}

function formatModelNames(models: Array<{ name?: string; model?: string }> = []) {
  return models
    .map(model => model.name || model.model)
    .filter((value): value is string => Boolean(value))
    .join(', ');
}

function buildEmbeddingDiagnosticError(values: {
  message: string;
  model: string;
  host: string;
  installedModels: string;
  activeModels: string;
}) {
  return [
    values.message,
    '',
    `Ollama host: ${values.host}`,
    `Selected embedding model: ${values.model}`,
    `Installed models: ${values.installedModels || 'none reported'}`,
    `Loaded models: ${values.activeModels || 'none reported'}`,
    '',
    'Ollama is reachable, but embedding generation did not complete. This is usually a stuck Ollama runner or GPU memory issue, not a Next.js upload problem.',
    'Immediate workaround: switch RAG mode to Keyword/BM25 in Settings.',
    'Host fix: stop the stuck large model runner, then run `sudo systemctl restart ollama` if a hidden runner remains. On this machine, the stuck runner was gemma4.',
  ].join('\n');
}

// POST: Test if an embedding model is available in Ollama
export async function POST(req: Request) {
  let testedModel = 'nomic-embed-text';
  let testedHost = 'http://127.0.0.1:11434';
  let installedModels = '';
  let activeModels = '';
  const startedAt = Date.now();

  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as TestEmbedBody;
    const settings = await getUserSettings(userId);
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
    const model = requestedModel || settings.ragModel;
    const ollamaHost = normalizeOllamaHost(body.host || settings.ollamaHost);
    testedModel = model || testedModel;
    testedHost = ollamaHost;

    if (!model) return NextResponse.json({ error: 'Model name required' }, { status: 400 });

    const tags = await fetchOllamaJson<OllamaTagsResponse>(`${ollamaHost}/api/tags`);
    const ps = await fetchOllamaJson<OllamaPsResponse>(`${ollamaHost}/api/ps`);
    installedModels = formatModelNames(tags.models);
    activeModels = formatModelNames(ps.models);
    const installed = (tags.models || []).some(item =>
      ollamaModelKey(item.name || item.model) === ollamaModelKey(model)
    );

    if (!installed) {
      return NextResponse.json({
        error: [
          `Embedding model "${model}" is not installed at ${ollamaHost}.`,
          `Run: ollama pull ${model}`,
          installedModels ? `Installed models: ${installedModels}` : ''
        ].filter(Boolean).join('\n')
      }, { status: 400 });
    }

    const embedding = await getEmbedding('test connection', model, ollamaHost, EMBED_TEST_TIMEOUT_MS);
    return NextResponse.json({
      ok: true,
      model,
      dimensions: embedding.length,
      host: ollamaHost,
      installedModels,
      activeModels,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const timeout = message.includes('timed out') || message.includes('timeout') || message.includes('aborted');

    if (timeout) {
      if (!installedModels && !activeModels) {
        try {
          const [tags, ps] = await Promise.all([
            fetchOllamaJson<OllamaTagsResponse>(`${testedHost}/api/tags`),
            fetchOllamaJson<OllamaPsResponse>(`${testedHost}/api/ps`),
          ]);
          installedModels = formatModelNames(tags.models);
          activeModels = formatModelNames(ps.models);
        } catch {
          // The original timeout is more useful than a secondary diagnostics failure.
        }
      }

      return NextResponse.json({
        error: buildEmbeddingDiagnosticError({
          message,
          model: testedModel,
          host: testedHost,
          installedModels,
          activeModels,
        })
      }, { status: 503 });
    }

    return NextResponse.json({
      error: message.includes('not found') || message.includes('pull')
        ? `${message}\n\nRun: ollama pull ${testedModel}`
        : message
    }, { status: 400 });
  }
}
