import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import {
  DEFAULT_HUGGING_FACE_BASE_URL,
  DEFAULT_SETTINGS,
  getUserSettings,
  normalizeHuggingFaceBaseUrl,
} from '@/lib/settings';
import { getErrorMessage, buildKnowledgeBaseContext } from '@/lib/rag';
import type { RagSearchResult } from '@/lib/rag';
import {
  buildResponsePresentationPrompt,
  inferResponsePresentation,
  normalizeResponsePresentation,
  type ResponsePresentation,
} from '@/lib/response-format';
import { buildOpenClawSystemPrompt, buildChatInternetToolPrompt } from '@/lib/openclaw-prompt';
import type { OpenClawPersona, OpenClawUserProfile } from '@/lib/openclaw-persona';
import { normalizeOpenClawProvider } from '@/lib/settings';
import { unloadOtherOllamaModels } from '@/lib/ollama-control';
import type { ServerStreamStatus } from '@/lib/stream-status';
import { isHuggingFaceRouterUrl } from './chat-platforms';
import { trimMessagesToFit, estimateStringTokens } from './message-trim';

const CHAT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OLLAMA_CONTEXT_LENGTH = 16384;
const MIN_CONTEXT_LENGTH = 512;
const OLLAMA_CONTEXT_CAP_ENV = 'VIEW_LLAMA_OLLAMA_CONTEXT_CAP';
const OLLAMA_START_TIMEOUT_MS = 60000;

const IMAGE_INSTRUCTIONS = 'For image requests, include actual image URLs using markdown syntax: ![description](https://...). Search for real URLs from reliable sources and render images inline.';
type ChatProvider = 'ollama' | 'openai-compatible' | 'huggingface';

function normalizeContextCap(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_CONTEXT_LENGTH) {
    return DEFAULT_OLLAMA_CONTEXT_LENGTH;
  }

  return Math.max(MIN_CONTEXT_LENGTH, Math.floor(parsed / MIN_CONTEXT_LENGTH) * MIN_CONTEXT_LENGTH);
}

const LOCAL_OLLAMA_CONTEXT_CAP = normalizeContextCap(process.env[OLLAMA_CONTEXT_CAP_ENV]);

interface IncomingChatMessage {
  role?: unknown;
  content?: unknown;
  images?: unknown;
}

interface IncomingChatBody {
  model?: unknown;
  chat_id?: unknown;
  session_id?: unknown;
  id?: unknown;
  response_presentation?: unknown;
  provider?: unknown;
  base_url?: unknown;
  baseUrl?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
  surface?: unknown;
  internet_enabled?: unknown;
  internet_tool_enabled?: unknown;
  rag_enabled?: unknown;
  rag_query?: unknown;
  rag_topk?: unknown;
  messages?: unknown;
}

interface InternalChatMessage {
  role: 'user' | 'assistant' | 'system';
  content?: string;
  images?: string[];
}

function normalizeMessages(messages: unknown): InternalChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .flatMap(rawMessage => {
      const message = rawMessage as IncomingChatMessage;
      const role = typeof message.role === 'string' ? message.role : '';
      const content = typeof message.content === 'string' ? message.content : '';
      const images = Array.isArray(message.images)
        ? message.images.filter((image): image is string => typeof image === 'string')
        : [];

      if (!['user', 'assistant', 'system'].includes(role) || (!content.trim() && images.length === 0)) return [];
      return [{
        role,
        content,
        ...(images.length > 0 ? { images } : {}),
      } as InternalChatMessage];
    })
}

function normalizeProvider(value: unknown): ChatProvider {
  if (value === 'huggingface') return 'huggingface';
  return normalizeOpenClawProvider(value) === 'openai-compatible' ? 'openai-compatible' : 'ollama';
}

function normalizeProviderBaseUrl(value: unknown, provider: ChatProvider, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const defaultValue = provider === 'openai-compatible'
    ? DEFAULT_OPENAI_COMPATIBLE_BASE_URL
    : provider === 'huggingface'
      ? DEFAULT_HUGGING_FACE_BASE_URL
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

  if (provider === 'huggingface') {
    return normalizeHuggingFaceBaseUrl(raw);
  }

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return url.origin;
  } catch {
    return defaultValue;
  }
}

function buildNumericContextCandidates(requestedContext: number, upperBound = LOCAL_OLLAMA_CONTEXT_CAP): number[] {
  const initial = Math.max(
    MIN_CONTEXT_LENGTH,
    Math.min(requestedContext, upperBound),
  );

  const candidates = [initial];
  let next = Math.floor(initial / 2);

  while (next >= MIN_CONTEXT_LENGTH) {
    if (!candidates.includes(next)) {
      candidates.push(next);
    }

    if (next === MIN_CONTEXT_LENGTH) break;
    next = Math.floor(next / 2);
  }

  return candidates;
}

function buildContextCandidates(requestedContext: number, preferNativeDefault: boolean): Array<number | null> {
  if (!preferNativeDefault) {
    return buildNumericContextCandidates(requestedContext);
  }

  const fallbackStart = Math.max(
    MIN_CONTEXT_LENGTH,
    Math.floor(Math.min(DEFAULT_SETTINGS.contextLength, LOCAL_OLLAMA_CONTEXT_CAP) / 2),
  );
  const fallbackCandidates = buildNumericContextCandidates(fallbackStart);
  return [null, ...fallbackCandidates];
}

function formatContextCandidate(candidate: number | null): string {
  return candidate === null ? 'Ollama default context' : `context ${candidate}`;
}

function normalizeInternetEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return false;
}

function normalizeRagEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return false;
}

function normalizeRagQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findLatestUserQuery(messages: InternalChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }

  return '';
}

function isContextMemoryError(message: string): boolean {
  return /requires more system memory|out of memory|cudaMalloc failed|model layout did not fit|failed to allocate/i.test(message);
}

function extractProviderErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Provider errors are often plain text; keep the raw body below.
  }

  return trimmed;
}

class UpstreamHttpError extends Error {
  status: number;
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  body: string;

  constructor(options: {
    provider: ChatProvider;
    status: number;
    baseUrl: string;
    model: string;
    body: string;
    fallback: string;
  }) {
    super(extractProviderErrorMessage(options.body) || options.fallback);
    this.name = 'UpstreamHttpError';
    this.status = options.status;
    this.provider = options.provider;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.body = options.body;
  }
}

function getProviderLabel(provider: ChatProvider): string {
  if (provider === 'huggingface') return 'Hugging Face'
  if (provider === 'openai-compatible') return 'OpenAI-compatible provider'
  return 'Ollama'
}

function getErrorProperty(error: unknown, property: string): unknown {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Record<string, unknown>)[property];
}

function collectErrorDetails(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  seen.add(error);

  const details: string[] = [];
  const code = getErrorProperty(error, 'code');
  const syscall = getErrorProperty(error, 'syscall');
  const address = getErrorProperty(error, 'address');
  const port = getErrorProperty(error, 'port');
  const message = error instanceof Error ? error.message : undefined;

  if (typeof code === 'string' && code.trim()) details.push(code.trim());
  if (typeof syscall === 'string' && syscall.trim()) details.push(`syscall ${syscall.trim()}`);
  if (typeof address === 'string' && address.trim()) {
    details.push(typeof port === 'number' || typeof port === 'string' ? `${address}:${port}` : address.trim());
  }
  if (message && message !== 'fetch failed' && message.trim()) details.push(message.trim());

  const cause = getErrorProperty(error, 'cause');
  return [...details, ...collectErrorDetails(cause, seen)].filter((detail, index, values) => values.indexOf(detail) === index);
}

function getUpstreamStatus(error: unknown): number | undefined {
  return error instanceof UpstreamHttpError ? error.status : undefined;
}

function formatUpstreamHttpError(error: UpstreamHttpError): string {
  const providerLabel = getProviderLabel(error.provider);
  const base = `${providerLabel} returned ${error.status} for "${error.model}" at ${error.baseUrl}: ${error.message}.`;

  if (/llama runner process has terminated|runner process has terminated/i.test(error.message)) {
    return `${base} The request reached Ollama, but the model runner crashed while loading or starting. This is an Ollama runtime/model-load failure, not an app network failure. If terminal works, compare the exact same model and context, check \`journalctl -u ollama\`, and try \`ollama stop ${error.model}\` before retrying.`;
  }

  if (isContextMemoryError(error.message)) {
    return `${base} The model/context combination exceeded available memory. The app will retry smaller context candidates when possible; if this is the final attempt, lower the context window or use a smaller model.`;
  }

  if (/not found|pull model|model .* not installed/i.test(error.message)) {
    return `${base} Pull or select an installed model, then retry.`;
  }

  return base;
}

function formatUpstreamError(options: {
  error: unknown;
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  fallback: string;
}): string {
  if (options.error instanceof UpstreamHttpError) {
    return formatUpstreamHttpError(options.error);
  }

  const message = getErrorMessage(options.error, options.fallback);
  const details = collectErrorDetails(options.error);
  const detailText = details.length ? ` Details: ${details.join(' · ')}.` : '';
  const providerLabel = getProviderLabel(options.provider);
  const detailSource = [message, ...details].join(' ');

  if (options.error instanceof TypeError || /fetch failed|network error|socket|ECONNRESET|ECONNREFUSED|UND_ERR/i.test(detailSource)) {
    const hint = options.provider === 'ollama'
      ? 'Make sure Ollama is running and responsive; if terminal `ollama run` also hangs, restart the Ollama service.'
      : options.provider === 'huggingface'
        ? 'Check the Hugging Face base URL, token, and network connection.'
        : 'Check the provider base URL, API key, and network connection.';
    return `${providerLabel} request failed before streaming for "${options.model}" at ${options.baseUrl}: ${message}.${detailText} ${hint}`;
  }

  return message;
}

async function streamOpenAICompatibleResponse(options: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: InternalChatMessage[];
  temperature: number;
  signal: AbortSignal;
  emit: (payload: Record<string, unknown>) => void;
}) {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey?.trim() ? { Authorization: `Bearer ${options.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages.map(message => ({
        role: message.role,
        content: message.content ?? '',
        ...(message.images?.length ? { images: message.images } : {}),
      })),
      stream: true,
      temperature: options.temperature,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'OpenAI-compatible provider error');
  }

  if (!response.body) {
    throw new Error('OpenAI-compatible provider did not return a response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (rawLine.startsWith('data:')) {
        const data = rawLine.slice(5).trim();
        if (data === '[DONE]') {
          options.emit({ done: true });
          return;
        }

        if (!data) {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: unknown;
                reasoning_content?: unknown;
                reasoning?: unknown;
              };
              finish_reason?: string | null;
            }>;
            usage?: { completion_tokens?: number; total_tokens?: number };
          };

          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          const content = typeof delta?.content === 'string' ? delta.content : '';
          const thinking = typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta?.reasoning === 'string'
              ? delta.reasoning
              : '';

          if (thinking) {
            options.emit({ message: { thinking } });
          }

          if (content) {
            options.emit({ message: { content } });
          }

          if (choice?.finish_reason) {
            options.emit({ done: true });
            return;
          }

          if (parsed.usage) {
            options.emit({
              done: true,
              eval_count: parsed.usage.completion_tokens ?? parsed.usage.total_tokens ?? undefined,
            });
          }
        } catch {
          // Ignore malformed chunks and keep streaming.
        }
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim();
    if (data && data !== '[DONE]') {
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }>;
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const content = typeof delta?.content === 'string' ? delta.content : '';
        const thinking = typeof delta?.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta?.reasoning === 'string'
            ? delta.reasoning
            : '';

        if (thinking) options.emit({ message: { thinking } });
        if (content) options.emit({ message: { content } });
      } catch {
        // Ignore tail parse errors.
      }
    }
  }

  options.emit({ done: true });
}

export async function createChatCompletionResponse(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await getUserSettings(userId);
    const body = await req.json() as IncomingChatBody;
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
    const messages = normalizeMessages(body.messages);
    const internetEnabled = normalizeInternetEnabled(body.internet_enabled);
    const internetToolEnabled = body.internet_tool_enabled === undefined
      ? internetEnabled
      : normalizeInternetEnabled(body.internet_tool_enabled);

    // RAG / Knowledge Base settings — use per-request flag if provided, else fall back to user settings
    const ragEnabled = normalizeRagEnabled(body.rag_enabled) || settings.ragEnabled;
    const ragQuery = normalizeRagQuery(body.rag_query);
    const rawRagTopK = Number(body.rag_topk ?? settings.ragTopK);
    // -1 means full access (retrieve all matching chunks)
    const ragTopK = rawRagTopK === -1 ? -1 : Math.min(200, Math.max(1, Math.round(rawRagTopK)));

    if (!messages.length || !requestedModel) {
      return NextResponse.json({ error: 'Messages and model are required' }, { status: 400 });
    }

    const chatId = typeof body.chat_id === 'string' && body.chat_id.trim() ? body.chat_id.trim() : '';
    const sessionId = typeof body.session_id === 'string' && body.session_id.trim() ? body.session_id.trim() : '';
    const assistantMessageId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const surface = body.surface === 'openclaw' ? 'openclaw' : 'chat';
    const provider = surface === 'openclaw'
      ? normalizeProvider(body.provider ?? settings.openClawProvider)
      : normalizeProvider(body.provider ?? settings.chatModelProvider);
    const baseUrl = normalizeProviderBaseUrl(
      body.base_url ?? body.baseUrl,
      provider,
      provider === 'huggingface'
        ? settings.huggingFaceBaseUrl
        : surface === 'openclaw'
        ? settings.openClawBaseUrl || settings.ollamaHost
        : settings.ollamaHost,
    );
    const apiKey = typeof body.api_key === 'string' && body.api_key.trim()
      ? body.api_key.trim()
      : typeof body.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : '';
    const hintedPresentation = normalizeResponsePresentation(body.response_presentation);
    const responsePresentation: ResponsePresentation = hintedPresentation.mode === 'general'
      ? inferResponsePresentation(messages)
      : hintedPresentation;

    const nonSystemMessages = messages.filter(message => message.role !== 'system');
    const presentationPrompt = buildResponsePresentationPrompt(responsePresentation);
    const openClawPersona: OpenClawPersona | undefined = surface === 'openclaw' ? {
      name: settings.openClawPersonaName,
      tone: settings.openClawPersonaTone,
      expertise: settings.openClawPersonaExpertise,
      boundaries: settings.openClawPersonaBoundaries,
      operatingInstructions: settings.openClawPersonaOperatingInstructions,
    } : undefined;

    const openClawUserProfile: OpenClawUserProfile | undefined = surface === 'openclaw' ? {
      name: settings.openClawUserProfileName,
      role: settings.openClawUserProfileRole,
      preferences: settings.openClawUserProfilePreferences,
      context: settings.openClawUserProfileContext,
    } : undefined;

    const openClawPrompt = surface === 'openclaw'
      ? buildOpenClawSystemPrompt({
          provider: provider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
          model: requestedModel,
          persona: openClawPersona,
          userProfile: openClawUserProfile,
          internetToolEnabled,
          shellEnabled: settings.shellExecutionMode !== 'deny',
          shellTarget: settings.shellExecutionTarget,
          filesystemEnabled: settings.openClawFileAccessMode === 'read-only',
          allowedFilesystemPaths: settings.openClawAllowedPaths
            ? settings.openClawAllowedPaths.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
            : [],
          filesystemWriteEnabled: settings.openClawFileWriteMode !== 'deny',
          writableFilesystemPaths: settings.openClawWritablePaths
            ? settings.openClawWritablePaths.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
            : [],
          codeExecutionEnabled: settings.openClawCodeExecutionMode !== 'deny',
          browserMode: settings.openClawBrowserMode,
          uwafBrowserMode: settings.openClawUwafBrowserMode,
        })
      : '';
    const chatInternetPrompt = surface === 'chat' && internetToolEnabled
      ? buildChatInternetToolPrompt()
      : '';
    const systemPromptParts = [
      ...(surface === 'chat' ? [IMAGE_INSTRUCTIONS] : []),
      settings.systemPrompt.trim(),
      openClawPrompt,
      chatInternetPrompt,
      presentationPrompt,
      ...messages
        .filter(message => message.role === 'system')
        .map(message => message.content?.trim() || ''),
    ].filter(Boolean);

    const systemPrompt = systemPromptParts.join('\n\n');
    const untrimmedMessages: InternalChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;

    // Trim conversation history to fit within context window
    const systemOverhead = estimateStringTokens(systemPrompt);
    const trimResult = trimMessagesToFit(untrimmedMessages, settings.contextLength, systemOverhead);
    const outboundMessages: InternalChatMessage[] = trimResult.messages as InternalChatMessage[];

    const encoder = new TextEncoder();
    const upstreamAbort = new AbortController();
    let closed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatStatus: ServerStreamStatus = 'connecting';

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sendJsonLine = (payload: Record<string, unknown>) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        const finish = () => {
          if (closed) return;
          closed = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          controller.close();
        };

        const fail = (message: string, status?: number) => {
          if (closed) return;
          sendJsonLine({
            error: message,
            ...(status ? { status } : {}),
            task_id: taskId,
            chat_id: chatId || undefined,
            session_id: sessionId || undefined,
            id: assistantMessageId,
          });
          finish();
        };

        const abortUpstream = () => upstreamAbort.abort();
        req.signal.addEventListener('abort', abortUpstream, { once: true });

        const emitStatus = (status: ServerStreamStatus) => {
          heartbeatStatus = status;
          sendJsonLine({
            task_id: taskId,
            chat_id: chatId || undefined,
            session_id: sessionId || undefined,
            id: assistantMessageId,
            status,
          });
        };

        emitStatus(heartbeatStatus);

        const streamOllamaResponse = async (numCtx: number | null, messagesForStream: InternalChatMessage[]) => {
          let startTimedOut = false;
          const startAbort = new AbortController();
          const startTimeout = setTimeout(() => {
            startTimedOut = true;
            startAbort.abort();
          }, OLLAMA_START_TIMEOUT_MS);
          const abortStart = () => startAbort.abort();

          // Use raw fetch instead of the Ollama SDK so <think> content is preserved in the stream.
          let ollamaRes: Response;
          try {
            emitStatus('starting-model');
            upstreamAbort.signal.addEventListener('abort', abortStart, { once: true });
            ollamaRes = await fetch(`${baseUrl}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: requestedModel,
                messages: messagesForStream,
                stream: true,
                options: {
                  temperature: settings.temperature,
                  ...(numCtx === null ? {} : { num_ctx: numCtx }),
                },
              }),
              signal: startAbort.signal,
            });
          } catch (error) {
            if (startTimedOut && !upstreamAbort.signal.aborted) {
              throw new Error(`Ollama did not start streaming within ${Math.round(OLLAMA_START_TIMEOUT_MS / 1000)} seconds with ${formatContextCandidate(numCtx)}. Restart Ollama or lower the context/model load pressure.`);
            }
            throw error;
          } finally {
            clearTimeout(startTimeout);
            upstreamAbort.signal.removeEventListener('abort', abortStart);
          }

          if (!ollamaRes.ok) {
            const text = await ollamaRes.text();
            throw new UpstreamHttpError({
              provider: 'ollama',
              status: ollamaRes.status,
              baseUrl,
              model: requestedModel,
              body: text,
              fallback: 'Ollama error',
            });
          }

          if (!ollamaRes.body) {
            throw new Error('Ollama did not return a response body');
          }

          emitStatus('streaming');

          const reader = ollamaRes.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        };

        heartbeatTimer = setInterval(() => {
          sendJsonLine({
            task_id: taskId,
            chat_id: chatId || undefined,
            session_id: sessionId || undefined,
            id: assistantMessageId,
            status: heartbeatStatus,
          });
        }, CHAT_HEARTBEAT_INTERVAL_MS);

        void (async () => {
          try {
            if (provider === 'openai-compatible' || provider === 'huggingface') {
              if (provider === 'huggingface' && isHuggingFaceRouterUrl(baseUrl) && !apiKey.trim()) {
                fail('Hugging Face chat requires an HF token when using the default router. Add your token in Settings → Chat → Hugging Face token.', 400);
                return;
              }

              let openAiMessages = outboundMessages
              let knowledgeSources: RagSearchResult[] = []

              if (ragEnabled) {
                emitStatus('knowledge-base');
                const query = ragQuery || findLatestUserQuery(outboundMessages);
                if (query) {
                  const kbResult = await buildKnowledgeBaseContext(query, userId, {
                    signal: upstreamAbort.signal,
                    topK: ragTopK,
                    keywordTopK: Math.round(ragTopK * 1.5),
                    semanticTopK: Math.round(ragTopK * 1.5),
                  });
                  if (kbResult.searched && kbResult.sources.length > 0) {
                    const kbSystemMessage: InternalChatMessage = {
                      role: 'system',
                      content: kbResult.context,
                    };
                    openAiMessages = [kbSystemMessage, ...openAiMessages];
                    knowledgeSources = kbResult.sources;
                  }
                }
              }

              if (knowledgeSources.length > 0) {
                sendJsonLine({ knowledge_sources: knowledgeSources })
              }

              emitStatus('streaming');

              await streamOpenAICompatibleResponse({
                baseUrl,
                apiKey,
                model: requestedModel,
                messages: openAiMessages,
                temperature: settings.temperature,
                signal: upstreamAbort.signal,
                emit: payload => sendJsonLine({
                  task_id: taskId,
                  chat_id: chatId || undefined,
                  session_id: sessionId || undefined,
                  id: assistantMessageId,
                  ...payload,
                }),
              });

              finish();
              return;
            }

            if (settings.exclusiveOllamaModels) {
              emitStatus('stopping-other-models');
              await unloadOtherOllamaModels(baseUrl, requestedModel, upstreamAbort.signal);
            }

            // Match the terminal/Open WebUI local path first: let Ollama choose
            // its own default context unless the user explicitly changed it.
            const preferNativeContext = settings.contextLength === DEFAULT_SETTINGS.contextLength;
            const contextCandidates = buildContextCandidates(settings.contextLength, preferNativeContext);

            for (const numCtx of contextCandidates) {
              try {
                let messagesForStream = outboundMessages
                let knowledgeSources: RagSearchResult[] = []

                if (ragEnabled) {
                  emitStatus('knowledge-base');
                  const query = ragQuery || findLatestUserQuery(outboundMessages);
                  if (query) {
                    const kbResult = await buildKnowledgeBaseContext(query, userId, {
                      signal: upstreamAbort.signal,
                      topK: ragTopK,
                      keywordTopK: Math.round(ragTopK * 1.5),
                      semanticTopK: Math.round(ragTopK * 1.5),
                    });
                    if (kbResult.searched && kbResult.sources.length > 0) {
                      const kbSystemMessage: InternalChatMessage = {
                        role: 'system',
                        content: kbResult.context,
                      };
                      messagesForStream = [kbSystemMessage, ...messagesForStream];
                      knowledgeSources = kbResult.sources;
                    }
                  }
                }

                if (knowledgeSources.length > 0) {
                  sendJsonLine({ knowledge_sources: knowledgeSources })
                }

                await streamOllamaResponse(numCtx, messagesForStream);
                finish();
                return;
              } catch (error) {
                const wasClientAbort = upstreamAbort.signal.aborted;
                if (wasClientAbort) {
                  finish();
                  return;
                }

                const message = formatUpstreamError({
                  error,
                  provider,
                  baseUrl,
                  model: requestedModel,
                  fallback: 'Failed to connect to Ollama',
                });
                const shouldRetry = isContextMemoryError(message) && numCtx !== contextCandidates[contextCandidates.length - 1];
                if (shouldRetry) {
                  continue;
                }

                fail(message, getUpstreamStatus(error));
                return;
              }
            }
          } catch (error) {
            const message = formatUpstreamError({
              error,
              provider,
              baseUrl,
              model: requestedModel,
              fallback: provider === 'ollama'
                ? 'Failed to connect to Ollama'
                : provider === 'huggingface'
                  ? 'Failed to connect to Hugging Face'
                  : 'Failed to connect to OpenAI-compatible provider',
            });
            const wasClientAbort = upstreamAbort.signal.aborted;

            if (!wasClientAbort) {
              upstreamAbort.abort();
            }

            if (wasClientAbort) {
              finish();
              return;
            }

            fail(message, getUpstreamStatus(error));
          } finally {
            req.signal.removeEventListener('abort', abortUpstream);
          }
        })();
      },
      cancel() {
        upstreamAbort.abort();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        closed = true;
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to connect to Ollama') }, { status: 500 });
  }
}
