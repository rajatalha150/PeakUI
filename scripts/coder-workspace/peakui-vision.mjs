#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

export function selectVisionRoute(settings) {
  const entries = Object.entries(settings.modelProviders ?? {}).flatMap(([provider, models]) =>
    Array.isArray(models) ? models.map(model => ({ ...model, provider })) : []);
  const pinned = String(settings.visionModel ?? '').trim();
  const match = pinned && entries.find(entry =>
    pinned === entry.id || pinned === `${entry.provider}:${entry.id}`);
  if (pinned && !match) throw new Error(`Configured Vision model ${JSON.stringify(pinned)} is not registered.`);
  const chosen = match ?? entries.find(entry =>
    entry.capabilities?.vision === true || entry.generationConfig?.modalities?.image === true);
  if (!chosen) throw new Error('No Vision model is configured or available. Select one in Coder settings.');
  if (chosen.capabilities?.vision !== true && chosen.generationConfig?.modalities?.image !== true) {
    throw new Error(`Configured Vision model ${JSON.stringify(chosen.id)} is not image-capable.`);
  }
  if (chosen.provider !== 'openai' || !chosen.baseUrl) {
    throw new Error(`Vision fallback needs an OpenAI-compatible endpoint for ${JSON.stringify(chosen.id)}.`);
  }
  return chosen;
}

export async function analyzeImage(filePath, question, options = {}) {
  const absolute = resolve(filePath);
  const mimeType = MIME.get(extname(absolute).toLowerCase());
  if (!mimeType) throw new Error('Supported image formats: PNG, JPEG, WebP.');
  const info = await stat(absolute);
  if (!info.isFile() || info.size === 0) throw new Error('Image is empty or not a regular file.');
  if (info.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB vision request limit.');
  const settingsPath = options.settingsPath ?? join(process.env.QWEN_HOME || join(homedir(), '.qwen'), 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const route = selectVisionRoute(settings);
  const image = await readFile(absolute);
  const baseUrl = route.baseUrl.replace(/\/$/, '');
  const parsedUrl = new URL(baseUrl);
  const localOllama = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname) && parsedUrl.pathname.endsWith('/v1');
  const url = localOllama ? `${baseUrl.slice(0, -3)}/api/chat` : `${baseUrl}/chat/completions`;
  const apiKey = process.env[route.envKey] || 'ollama';
  const body = localOllama
    ? {
        model: route.id,
        stream: false,
        think: false,
        options: { num_predict: 1200 },
        messages: [{ role: 'user', content: question || 'Describe what is visibly present in this image. Identify errors or incomplete loading. Do not guess from context or HTTP status.', images: [image.toString('base64')] }],
      }
    : {
        model: route.id,
        stream: false,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: question || 'Describe what is visibly present in this image. Identify errors or incomplete loading. Do not guess from context or HTTP status.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
          ],
        }],
      };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(!localOllama ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
  });
  if (!response.ok) throw new Error(`Vision model ${route.id} returned HTTP ${response.status}.`);
  const data = await response.json();
  const content = localOllama ? data?.message?.content : data?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim()
    : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n').trim()
      : '';
  if (!text) throw new Error(`Vision model ${route.id} returned no visual description${data?.message?.thinking ? ' (only thinking)' : ''}.`);
  return { model: route.id, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write('Usage: peakui-vision <image-path> [question]\n');
    process.exitCode = 2;
  } else {
    try {
      const result = await analyzeImage(filePath, process.argv.slice(3).join(' '));
      process.stdout.write(process.env.PEAKUI_VISION_JSON === '1' ? `${JSON.stringify(result)}\n` : `Vision model: ${result.model}\n${result.text}\n`);
    } catch (error) {
      process.stderr.write(`Vision analysis unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
