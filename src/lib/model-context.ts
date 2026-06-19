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
  const parameterSizeB = parseModelParameterSizeB(modelName);
  const cloud = isCloudModel(modelName, provider);

  if (cloud) {
    return {
      defaultContext: 16384,
      maxContext: 131072,
      isCloud: true,
      parameterSizeB,
    };
  }

  const looksSmall = SMALL_LOCAL_MODELS.test(modelName)
    || (parameterSizeB !== null && parameterSizeB <= 4);

  if (looksSmall) {
    return {
      defaultContext: 2048,
      maxContext: 4096,
      isCloud: false,
      parameterSizeB,
    };
  }

  if (parameterSizeB !== null) {
    if (parameterSizeB <= 9) {
      return {
        defaultContext: 4096,
        maxContext: 8192,
        isCloud: false,
        parameterSizeB,
      };
    }
    if (parameterSizeB <= 30) {
      return {
        defaultContext: 8192,
        maxContext: 16384,
        isCloud: false,
        parameterSizeB,
      };
    }
    return {
      defaultContext: 8192,
      maxContext: 32768,
      isCloud: false,
      parameterSizeB,
    };
  }

  // Unknown local model: be conservative so the first turn is responsive.
  return {
    defaultContext: 4096,
    maxContext: 8192,
    isCloud: false,
    parameterSizeB: null,
  };
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
