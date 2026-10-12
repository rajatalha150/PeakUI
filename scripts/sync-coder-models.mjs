/**
 * Syncs Ollama's live model list into the Coder daemon's settings.json.
 *
 * The daemon only routes to models declared in its `modelProviders` config
 * (~/.qwen/settings.json). Ollama exposes its full list (local + cloud) at
 * /api/tags. This script mirrors that list under the `openai` provider (which
 * points at Ollama's OpenAI-compatible /v1 endpoint), so every model the user
 * can pick in the UI is actually routable by the daemon.
 *
 * Tools capability is recorded, not filtered: /api/tags reports each model's
 * `capabilities`, and the agent only works with models that include `tools`.
 * We annotate the description so the daemon's model picker can show why a
 * completion-only model will not drive the agent — silently offering them is
 * what produced an agent that claimed it had no tools.
 *
 * Runs at coder-container startup and when the live model picker refreshes.
 * A refresh preserves the selected model and writes only when Ollama's model
 * catalogue changed, so reading the picker cannot churn settings.json.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const OLLAMA_BASE_URL = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || '';
const PRESERVE_SELECTED_MODEL = process.env.CODER_MODEL_SYNC_PRESERVE_DEFAULT === '1';
const STRICT = process.argv.includes('--strict');
const SETTINGS_PATH = path.join(process.env.QWEN_HOME || path.join(homedir(), '.qwen'), 'settings.json');

// Coder falls back to a generic 200k window for an OpenAI-compatible model it
// does not recognize by name. Ollama already exposes the actual model limit in
// /api/tags, so carry it into Coder's per-model generation configuration.
// Coder accepts positive integers up to 10 million here; reject bad provider
// metadata rather than accidentally replacing its own fallback with nonsense.
function contextWindowSize(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 10_000_000
    ? value
    : undefined;
}

async function fetchOllamaModels() {
  const tagsUrl = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '') + '/api/tags';
  const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  const models = Array.isArray(data.models) ? data.models : [];
  return models
    .map(m => {
      const caps = Array.isArray(m?.capabilities) ? m.capabilities : [];
      return {
        name: typeof m?.name === 'string' ? m.name : '',
        tools: caps.includes('tools'),
        vision: caps.includes('vision'),
        contextWindowSize: contextWindowSize(m?.details?.context_length),
      };
    })
    .filter(m => m.name);
}

/**
 * Pick the model the daemon should start on.
 *
 * Order: the configured CODER_MODEL (if it exists here) → the first
 * tools-capable model → the first model at all. Landing on a tools-capable
 * model by default matters: a completion-only default makes the agent answer
 * "I have no tools" and hallucinate results, which reads as "tools are broken"
 * rather than "wrong model selected".
 */
function pickDefault(models) {
  if (DEFAULT_MODEL && models.some(m => m.name === DEFAULT_MODEL)) {
    const chosen = models.find(m => m.name === DEFAULT_MODEL);
    if (!chosen.tools) {
      console.warn(
        `[coder-sync] CODER_MODEL="${DEFAULT_MODEL}" is not tools-capable; ` +
          `the coding agent needs native function calling. Prefer: ` +
          models.filter(m => m.tools).map(m => m.name).join(', ') || '(none found)',
      );
    }
    return DEFAULT_MODEL;
  }
  if (DEFAULT_MODEL) {
    console.warn(
      `[coder-sync] CODER_MODEL="${DEFAULT_MODEL}" is not present in Ollama; falling back.`,
    );
  }
  const capable = models.find(m => m.tools);
  if (capable) return capable.name;
  console.warn('[coder-sync] no tools-capable model found; the agent will not be able to act.');
  return models[0].name;
}

/**
 * Pick a vision-capable model for the daemon's `visionModel` setting.
 *
 * The vision bridge is what lets a text-only main model "see" screenshots and
 * images: the daemon transcribes them with this model first. Without it,
 * `read_file` on an image / PDF and any screenshot-driven verification silently
 * fail — the agent audits the codebase but cannot visually confirm a UI.
 */
function pickVisionModel(models, defaultModel) {
  // The vision bridge only matters when the main model is text-only. If the
  // main model already has vision, a separate bridge is unnecessary.
  const main = models.find(m => m.name === defaultModel);
  if (main?.vision) return '';
  const visionCapable = models.filter(m => m.vision);
  if (visionCapable.length === 0) return '';
  // Prefer a vision model that is ALSO tools-capable so it can drive the agent
  // if the main model is ever swapped; otherwise the first vision model.
  return (visionCapable.find(m => m.tools) || visionCapable[0]).name;
}

async function main() {
  try {
    const models = await fetchOllamaModels();
    if (models.length === 0) {
      console.error('[coder-sync] Ollama returned no models; keeping existing settings.json');
      if (STRICT) process.exitCode = 1;
      return;
    }

    // Preserve anything the app/daemon owns in this file (security, tools
    // knobs the user set through the Coding settings drawer) instead of
    // clobbering it on every container start.
    let existing = {};
    try {
      existing = JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf-8'));
    } catch {
      existing = {};
    }

    const previousModel = existing.model?.name;
    const defaultModel = PRESERVE_SELECTED_MODEL && models.some(m => m.name === previousModel)
      ? previousModel : pickDefault(models);
    const toolsCapable = models.filter(m => m.tools).length;
    const previousVision = existing.visionModel;
    const visionModel = PRESERVE_SELECTED_MODEL && models.some(m => m.name === previousVision && m.vision)
      ? previousVision : pickVisionModel(models, defaultModel);

    const settings = {
      ...existing,
      modelProviders: {
        ...(existing.modelProviders || {}),
        openai: models.map(m => ({
          id: m.name,
          // Explicit envKey so the daemon resolves credentials from
          // OPENAI_API_KEY (set to a dummy "local" for Ollama). Without an
          // envKey the daemon refuses the switch with "Missing credentials".
          envKey: 'OPENAI_API_KEY',
          baseUrl: OLLAMA_BASE_URL,
          // Declare capabilities EXPLICITLY. Without this the daemon falls
          // back to name heuristics (defaultModalities) that misclassify
          // arbitrary Ollama ids — e.g. `/^deepseek/` → text-only, so a
          // genuinely vision-capable model is silently treated as blind and
          // the vision bridge (or native image handling) is never enabled.
          capabilities: {
            ...(m.vision ? { vision: true } : {}),
            ...(m.tools ? { agent: true } : {}),
          },
          generationConfig: {
            ...(m.contextWindowSize ? { contextWindowSize: m.contextWindowSize } : {}),
            ...(m.vision ? { modalities: { image: true } } : {}),
          },
        })),
      },
      model: {
        ...(existing.model || {}),
        name: defaultModel,
        baseUrl: OLLAMA_BASE_URL,
      },
      // Vision bridge: lets the (text-only) main model "see" screenshots and
      // images. Empty when no vision-capable model exists in Ollama.
      ...(visionModel ? { visionModel } : {}),
    };

    const changed = JSON.stringify(settings) !== JSON.stringify(existing);
    if (changed) {
      await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
      const temporary = `${SETTINGS_PATH}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
        await fs.rename(temporary, SETTINGS_PATH);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    }
    console.log(
      `[coder-sync] ${changed ? 'updated' : 'unchanged'} ${models.length} models in ${SETTINGS_PATH} ` +
          `(${toolsCapable} tools-capable; ${models.filter(m => m.contextWindowSize).length} with native context); default=${defaultModel}`,
    );
    console.log(JSON.stringify({ changed, count: models.length }));
  } catch (error) {
    console.error('[coder-sync] failed:', error instanceof Error ? error.message : String(error));
    // Startup remains non-fatal, but a live refresh must surface the failure.
    if (STRICT) process.exitCode = 1;
  }
}

main();
