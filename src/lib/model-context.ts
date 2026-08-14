/**
 * Model-specific context recommendations for local-first inference.
 *
 * Smaller local models allocate KV-cache proportional to the requested context
 * window. Asking an 8B CPU-bound model to evaluate a prompt at 8k or 16k
 * context is the main reason simple greetings appear to "never start" in
 * PeakUI. This module gives the chat pipeline conservative, model-aware
 * defaults that keep first-token latency reasonable without removing the
 * user’s ability to override.
 */

export interface ModelContextRecommendation {
  /** Recommended num_ctx for the first attempt. */
  defaultContext: number;
  /** Hard cap for automatic fallback candidates. */
  maxContext: number;
  /** True for remote/API models that should not be capped locally. */
  isCloud: boolean;
  /** Detected parameter size in billions, null if unknown. */
  parameterSizeB: number | null;
}

/**
 * Graduated system-prompt detail tiers. The prompt shrinks as the model gets
 * smaller so the tool manifest fits inside the model's context window next to
 * the conversation and response.
 */
export type PromptTier = 'minimal' | 'compact' | 'standard' | 'full';

/**
 * Authoritative model capacity, detected from Ollama `/api/show` when
 * available and falling back to name-based heuristics. Drives both the prompt
 * tier and the num_ctx recommendation.
 */
export interface ModelCapacityProfile {
  /** Detected parameter size in billions, null if unknown. */
  parameterSizeB: number | null;
  /** Model's native context window from `/api/show`, null if unknown. */
  nativeContextLength: number | null;
  /** True for remote/API models that should not be capped locally. */
  isCloud: boolean;
  /** Prompt detail tier for this model. */
  promptTier: PromptTier;
  /** Recommended num_ctx for the first attempt (clamped to native window). */
  recommendedContext: number;
  /** Hard cap for automatic fallback candidates (clamped to native window). */
  maxContext: number;
}

const SMALL_LOCAL_MODELS = /\b(phi4-mini|phi3:mini|phi3:3\.8b|gemma2:2b|qwen3:1\.7b|qwen3:4b|qwen2\.5:3b|qwen2\.5:7b|llama3\.2:1b|llama3\.2:3b|granite4\.1:3b|granite3\.1:3b|granite3\.1:8b|nomic|mxbai|snowflake|all-minilm|bge-)/i;

export function isCloudModel(modelName: string, provider?: string): boolean {
  return provider === 'openai-compatible' || /(:|-)cloud$/i.test(modelName);
}

export function parseModelParameterSizeB(modelName: string): number | null {
  // Match tags like :4b, :8b, :70b, :3.8b, :120b-cloud, -8b-, etc.
  const match = modelName.match(/[:/_-](\d+(?:\.\d+)?)\s*b\b/i);
  if (match) return parseFloat(match[1]);
  return null;
}

export function getModelContextRecommendation(
  modelName: string,
  provider: string = 'ollama',
): ModelContextRecommendation {
  const profile = computeProfileFromName(modelName, provider);
  return {
    defaultContext: profile.recommendedContext,
    maxContext: profile.maxContext,
    isCloud: profile.isCloud,
    parameterSizeB: profile.parameterSizeB,
  };
}

/**
 * Pure name-based capacity profile. Shared by the legacy sync wrappers and as
 * the fallback when `/api/show` is unavailable. `nativeContextLength` is null
 * here, so no native-window raise/clamp is applied.
 */
function computeProfileFromName(modelName: string, provider: string): ModelCapacityProfile {
  return buildProfileFromCapacity(modelName, provider, parseModelParameterSizeB(modelName), null);
}

/**
 * Applies the native-context rules on top of the conservative bucket defaults:
 * 1. Raise the default when the model's own window comfortably allows it
 *    (≤4B → 4096 when native ≥ 4096; ≤9B → 8192 when native ≥ 8192). Safe
 *    because the chat pipeline's `isContextMemoryError` retry loop backs off
 *    to the next smaller candidate on OOM.
 * 2. Clamp both values to the native window, rounded down to a multiple of 512.
 */
function applyNativeContext(
  defaultContext: number,
  maxContext: number,
  nativeContextLength: number | null,
): { recommendedContext: number; maxContext: number } {
  if (nativeContextLength === null) {
    return { recommendedContext: defaultContext, maxContext };
  }
  const step = 512;
  const clamp = (value: number) => Math.max(step, Math.floor(Math.min(value, nativeContextLength) / step) * step);
  let recommended = defaultContext;
  if (defaultContext === 2048 && nativeContextLength >= 4096) recommended = 4096;
  else if (defaultContext === 4096 && nativeContextLength >= 8192) recommended = 8192;
  return { recommendedContext: clamp(recommended), maxContext: clamp(maxContext) };
}

function buildProfileFromCapacity(
  modelName: string,
  provider: string,
  parameterSizeB: number | null,
  nativeContextLength: number | null,
): ModelCapacityProfile {
  const isCloud = isCloudModel(modelName, provider);

  if (isCloud) {
    return {
      parameterSizeB,
      nativeContextLength,
      isCloud: true,
      promptTier: 'full',
      recommendedContext: 16384,
      maxContext: 131072,
    };
  }

  // A name with no size tag that matches the known-small regex is treated as
  // a 4B model (preserves the legacy `looksSmall` behavior).
  const effectiveSize = parameterSizeB ?? (SMALL_LOCAL_MODELS.test(modelName) ? 4 : null);

  let promptTier: PromptTier;
  let defaultContext: number;
  let maxContext: number;

  if (effectiveSize !== null && effectiveSize <= 4) {
    promptTier = 'minimal';
    defaultContext = 2048;
    maxContext = 4096;
  } else if (effectiveSize !== null && effectiveSize <= 9) {
    promptTier = 'compact';
    defaultContext = 4096;
    maxContext = 8192;
  } else if (effectiveSize !== null && effectiveSize <= 30) {
    promptTier = 'standard';
    defaultContext = 8192;
    maxContext = 16384;
  } else if (effectiveSize !== null) {
    promptTier = 'full';
    defaultContext = 8192;
    maxContext = 32768;
  } else {
    // Unknown local model: be conservative so the first turn is responsive.
    promptTier = 'compact';
    defaultContext = 4096;
    maxContext = 8192;
  }

  const { recommendedContext, maxContext: clampedMax } = applyNativeContext(
    defaultContext,
    maxContext,
    nativeContextLength,
  );

  return {
    parameterSizeB,
    nativeContextLength,
    isCloud,
    promptTier,
    recommendedContext,
    maxContext: clampedMax,
  };
}

interface OllamaShowResponse {
  details?: { parameter_size?: string };
  model_info?: Record<string, unknown>;
  general?: { parameter_count?: number; context_length?: number };
}

interface CapacityCacheEntry {
  profile: ModelCapacityProfile;
  expiresAt: number;
}

const CAPACITY_CACHE_TTL_MS = 5 * 60_000;
const capacityCache = new Map<string, CapacityCacheEntry>();

/** Clears the `/api/show` capacity cache (used by tests). */
export function clearModelCapacityCache(): void {
  capacityCache.clear();
}

/**
 * Parses an Ollama `/api/show` response into capacity numbers, handling both
 * API shapes: the older `details.parameter_size` + `model_info["<family>.context_length"]`
 * and the newer `general.parameter_count` + `general.context_length`.
 */
function parseOllamaShowCapacity(data: OllamaShowResponse): {
  parameterSizeB: number | null;
  nativeContextLength: number | null;
} {
  let parameterSizeB: number | null = null;
  let nativeContextLength: number | null = null;

  const paramSize = data.details?.parameter_size;
  if (typeof paramSize === 'string') {
    const match = paramSize.match(/(\d+(?:\.\d+)?)\s*B/i);
    if (match) parameterSizeB = parseFloat(match[1]);
  }
  if (data.model_info) {
    for (const [key, value] of Object.entries(data.model_info)) {
      if (key.endsWith('.context_length') && typeof value === 'number') {
        nativeContextLength = value;
        break;
      }
    }
  }

  if (parameterSizeB === null && typeof data.general?.parameter_count === 'number') {
    parameterSizeB = data.general.parameter_count / 1e9;
  }
  if (nativeContextLength === null && typeof data.general?.context_length === 'number') {
    nativeContextLength = data.general.context_length;
  }

  return { parameterSizeB, nativeContextLength };
}

/**
 * Detects a model's capacity (parameter size + native context window) and maps
 * it to a prompt tier and context recommendation. Queries Ollama `/api/show`
 * (cached 5 min per model) and falls back to name-based heuristics on any
 * failure. Non-Ollama providers always get the cloud profile without a fetch.
 */
export async function getModelCapacityProfile(
  modelName: string,
  provider: string = 'ollama',
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<ModelCapacityProfile> {
  if (provider !== 'ollama' || !baseUrl) {
    return computeProfileFromName(modelName, provider);
  }

  const host = baseUrl.replace(/\/$/, '');
  const cacheKey = `${host}|${modelName}`;
  const cached = capacityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  try {
    const timeoutSignal = AbortSignal.timeout(5000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, name: modelName }),
      signal: combinedSignal,
    });
    if (!response.ok) throw new Error(`Ollama /api/show failed: ${response.status}`);
    const data = (await response.json().catch(() => null)) as OllamaShowResponse | null;
    if (!data) throw new Error('Ollama /api/show returned no data');
    const { parameterSizeB, nativeContextLength } = parseOllamaShowCapacity(data);
    const profile = buildProfileFromCapacity(modelName, provider, parameterSizeB, nativeContextLength);
    capacityCache.set(cacheKey, { profile, expiresAt: Date.now() + CAPACITY_CACHE_TTL_MS });
    return profile;
  } catch {
    // Transient failure — fall back to name detection, do not cache the failure.
    return computeProfileFromName(modelName, provider);
  }
}

/**
 * Returns true for small local models where the full WorkSpaces tool tutorial
 * prompt is large enough to cause noticeable first-token stalls. Cloud/API
 * models and larger local models keep the full manifest so tools behave
 * correctly on first use.
 */
export function shouldUseCompactToolManifest(
  modelName: string,
  provider: string = 'ollama',
): boolean {
  const recommendation = getModelContextRecommendation(modelName, provider);
  if (recommendation.isCloud) return false;
  // Anything at or below the 9B bucket default (4096) is small enough that
  // trimming verbose tool examples keeps the first turn responsive.
  return recommendation.defaultContext <= 4096;
}
