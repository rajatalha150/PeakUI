/**
 * Syncs Ollama's live model list into the Qwen Code daemon's settings.json.
 *
 * The daemon only routes to models declared in its `modelProviders` config
 * (~/.qwen/settings.json). Ollama exposes its full list (local + cloud) at
 * /api/tags. This script mirrors that list under the `openai` provider (which
 * points at Ollama's OpenAI-compatible /v1 endpoint), so every model the user
 * can pick in the UI is actually routable by the daemon.
 *
 * Runs at coder-container startup, before the daemon. Idempotent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const OLLAMA_BASE_URL = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || '';
const SETTINGS_PATH = path.join(homedir(), '.qwen', 'settings.json');

async function fetchOllamaModels() {
  const tagsUrl = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '') + '/api/tags';
  const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  const models = Array.isArray(data.models) ? data.models : [];
  return models.map(m => (typeof m.name === 'string' ? m.name : '')).filter(Boolean);
}

async function main() {
  try {
    const models = await fetchOllamaModels();
    if (models.length === 0) {
      console.error('[coder-sync] Ollama returned no models; keeping existing settings.json');
      return;
    }

    const settings = {
      modelProviders: {
        openai: models.map(id => ({
          id,
          // No envKey: falls back to OPENAI_API_KEY, which is set to a dummy
          // value in the container for local Ollama.
          baseUrl: OLLAMA_BASE_URL,
        })),
      },
      model: {
        name: DEFAULT_MODEL && models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0],
      },
    };

    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log(`[coder-sync] wrote ${models.length} models to ${SETTINGS_PATH}`);
  } catch (error) {
    console.error('[coder-sync] failed:', error instanceof Error ? error.message : String(error));
    // Non-fatal: the daemon will start with whatever settings.json exists.
  }
}

main();
