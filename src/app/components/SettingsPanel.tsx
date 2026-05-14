"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Server, Bot, Database, MessageSquare,
  CheckCircle, AlertCircle, Loader2, Save, Palette
} from 'lucide-react';
import { ollamaModelKey, RECOMMENDED_EMBEDDING_MODELS } from '@/lib/embedding-models';
import { applyTheme, THEME_OPTIONS } from '@/lib/theme-options';
import HelpHint from './HelpHint';
import {
  buildChatModelOptionId,
  DEFAULT_HUGGING_FACE_BASE_URL,
  isHuggingFaceRouterUrl,
  type ChatModelOption,
  type ChatPlatform,
} from '@/lib/chat-platforms';

const HUGGING_FACE_API_KEY_STORAGE = 'peakui-huggingface-api-key';

interface UserSettings {
  chatPlatform: ChatPlatform;
  chatModel: string;
  chatModelProvider: 'ollama' | 'huggingface';
  huggingFaceBaseUrl: string;
  exclusiveOllamaModels: boolean;
  openClawProvider: string;
  openClawModel: string;
  openClawBaseUrl: string;
  shellExecutionTarget: 'container' | 'host';
  shellExecutionMode: string;
  shellAllowedCommands: string;
  shellHostAllowedRoots: string;
  shellHostAllowedEnvVars: string;
  shellHostMaxTimeoutMs: number;
  shellHostMaxOutputBytes: number;
  openClawFileAccessMode: string;
  openClawAllowedPaths: string;
  openClawFileWriteMode: string;
  openClawWritablePaths: string;
  openClawCodeExecutionMode: string;
  openClawBrowserMode: string;
  openClawUwafBrowserMode: string;
  openClawUwafScreenshots: boolean;
  openClawUwafDefaultMode: string;
  openClawUwafLiveBrowser: boolean;
  ragModel: string;
  ragMode: string;
  ragEnabled: boolean;
  ragTopK: number;
  ollamaHost: string;
  systemPrompt: string;
  temperature: number;
  contextLength: number;
  theme: string;
}

interface Model {
  name: string;
}

interface Props {
  onSettingsChange?: (settings: UserSettings) => void;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ color: 'var(--accent-primary)' }}>{icon}</div>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: React.ReactNode; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
        {label}
      </div>
      {children}
      {help && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.4 }}>{help}</div>}
    </div>
  );
}

export default function SettingsPanel({ onSettingsChange }: Props) {
  const [settings, setSettings] = useState<UserSettings>({
    chatPlatform: 'ollama',
    chatModel: '',
    chatModelProvider: 'ollama',
    huggingFaceBaseUrl: DEFAULT_HUGGING_FACE_BASE_URL,
    exclusiveOllamaModels: false,
    openClawProvider: 'ollama',
    openClawModel: '',
    openClawBaseUrl: '',
    shellExecutionTarget: 'container',
    shellExecutionMode: 'ask-first',
    shellAllowedCommands: '',
    shellHostAllowedRoots: '/tmp/peakui-openclaw-workspace',
    shellHostAllowedEnvVars: 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
    shellHostMaxTimeoutMs: 60000,
    shellHostMaxOutputBytes: 262144,
    openClawFileAccessMode: 'deny',
    openClawAllowedPaths: '',
    openClawFileWriteMode: 'deny',
    openClawWritablePaths: '/tmp/peakui-openclaw-workspace',
    openClawCodeExecutionMode: 'deny',
    openClawBrowserMode: 'deny',
    openClawUwafBrowserMode: 'deny',
    openClawUwafScreenshots: true,
    openClawUwafDefaultMode: 'direct',
    openClawUwafLiveBrowser: true,
    ragModel: 'nomic-embed-text',
    ragMode: 'semantic',
    ragEnabled: false,
    ragTopK: 8,
    ollamaHost: 'http://127.0.0.1:11434',
    systemPrompt: '',
    temperature: 0.7,
    contextLength: 16384,
    theme: 'aurora',
  });
  const [models, setModels] = useState<Model[]>([]);
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [huggingFaceApiKey, setHuggingFaceApiKey] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(HUGGING_FACE_API_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  });
  const [testingEmbed, setTestingEmbed] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [embedError, setEmbedError] = useState('');
  const [embedDetails, setEmbedDetails] = useState('');

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!data.error) {
        setSettings(data);
        applyTheme(data.theme);
        return data as UserSettings;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  const fetchModels = useCallback(async (host: string) => {
    setOllamaStatus('checking');
    try {
      const res = await fetch(host ? `/api/tags?host=${encodeURIComponent(host)}` : '/api/tags');
      const data = await res.json();
      if (data.models) {
        setModels(data.models);
        setOllamaStatus('online');
      } else {
        setOllamaStatus('offline');
      }
    } catch {
      setOllamaStatus('offline');
    }
  }, []);

  const fetchChatModels = useCallback(async (settingsToUse: UserSettings, apiKey = huggingFaceApiKey) => {
    setChatModelsLoading(true);
    try {
      const res = await fetch('/api/chat/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: settingsToUse.chatPlatform,
          ollamaHost: settingsToUse.ollamaHost,
          huggingFaceBaseUrl: settingsToUse.huggingFaceBaseUrl,
          apiKey,
        }),
      });
      const data = await res.json().catch(() => ({})) as { models?: ChatModelOption[] };
      const nextModels = Array.isArray(data.models) ? [...data.models] : [];
      const savedModelName = typeof settingsToUse.chatModel === 'string' ? settingsToUse.chatModel.trim() : '';
      const savedModelProvider = settingsToUse.chatModelProvider;
      if (savedModelName && savedModelProvider === 'huggingface' && !nextModels.some(model => model.name === savedModelName && model.provider === 'huggingface')) {
        nextModels.unshift({
          id: `huggingface::${savedModelName}`,
          name: savedModelName,
          model: savedModelName,
          provider: 'huggingface',
          sourceLabel: (settingsToUse.huggingFaceBaseUrl || DEFAULT_HUGGING_FACE_BASE_URL) === DEFAULT_HUGGING_FACE_BASE_URL
            ? 'Hugging Face'
            : settingsToUse.huggingFaceBaseUrl || DEFAULT_HUGGING_FACE_BASE_URL,
        });
      }
      setChatModels(nextModels);
    } catch (error) {
      console.error('Failed to load chat models:', error);
      setChatModels([]);
    } finally {
      setChatModelsLoading(false);
    }
  }, [huggingFaceApiKey]);

  const persistHuggingFaceApiKey = useCallback((value: string) => {
    setHuggingFaceApiKey(value);
    try {
      window.localStorage.setItem(HUGGING_FACE_API_KEY_STORAGE, value);
      window.dispatchEvent(new Event('peakui-hf-token-change'));
    } catch {
      // Ignore browser storage failures.
    }
  }, []);

  useEffect(() => {
    const loadInitialSettings = async () => {
      const loadedSettings = await fetchSettings();
      const nextSettings = loadedSettings || settings;
      await Promise.all([
        fetchModels(nextSettings.ollamaHost),
        fetchChatModels(nextSettings, huggingFaceApiKey),
      ]);
    };

    void loadInitialSettings();
  }, [fetchSettings, fetchModels, fetchChatModels, huggingFaceApiKey]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      void fetchChatModels(settings);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, settings.chatPlatform, settings.ollamaHost, settings.huggingFaceBaseUrl, huggingFaceApiKey, fetchChatModels]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!data.error) {
        setSaved(true);
        setSettings(data);
        applyTheme(data.theme);
        onSettingsChange?.(data);
        void fetchModels(data.ollamaHost);
        void fetchChatModels(data, huggingFaceApiKey);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmbedding = async () => {
    setTestingEmbed(true);
    setEmbedStatus('idle');
    setEmbedError('');
    setEmbedDetails('');
    try {
      const res = await fetch('/api/rag/test-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.ragModel, host: settings.ollamaHost })
      });
      const data = await res.json();
      if (res.ok) {
        const seconds = Math.max(1, Math.round((Number(data.durationMs) || 0) / 1000));
        const dimensions = typeof data.dimensions === 'number' ? data.dimensions.toLocaleString() : data.dimensions;
        setEmbedStatus('ok');
        setEmbedDetails(`${data.model || settings.ragModel} · ${dimensions} dimensions · ${seconds}s`);
      } else {
        setEmbedStatus('error');
        setEmbedError(data.error || 'Unknown error');
      }
    } catch (e) {
      setEmbedStatus('error');
      setEmbedError(e instanceof Error ? e.message : 'Embedding test failed');
    } finally {
      setTestingEmbed(false);
    }
  };

  const update = <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'chatPlatform') {
        if (value === 'ollama') {
          next.chatModelProvider = 'ollama';
        } else if (value === 'huggingface') {
          next.chatModelProvider = 'huggingface';
        }
      }
      return next;
    });
    if (field === 'theme') applyTheme(value as string);
    if (field === 'ragModel') {
      setEmbedStatus('idle');
      setEmbedError('');
      setEmbedDetails('');
    }
    setSaved(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} color="var(--accent-primary)" />
      </div>
    );
  }

  const installedModelKeys = new Set(models.map(model => ollamaModelKey(model.name)));
  const recommendedModelKeys = new Set(RECOMMENDED_EMBEDDING_MODELS.map(model => ollamaModelKey(model.name)));
  const otherInstalledModels = models.filter(model => !recommendedModelKeys.has(ollamaModelKey(model.name)));
  const visibleChatModels = chatModels.filter(model => {
    if (settings.chatPlatform === 'ollama') return model.provider === 'ollama';
    if (settings.chatPlatform === 'huggingface') return model.provider === 'huggingface';
    return true;
  });
  const selectedChatModelId = settings.chatModel
    ? buildChatModelOptionId(settings.chatModelProvider, settings.chatModel)
    : '';
  const needsHuggingFaceTokenForDiscovery = (
    settings.chatPlatform === 'huggingface' || settings.chatPlatform === 'hybrid'
  ) && isHuggingFaceRouterUrl(settings.huggingFaceBaseUrl) && !huggingFaceApiKey.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '24px', gap: '4px', maxWidth: '680px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '10px' }}>
              <Settings size={22} color="white" />
            </div>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Settings</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>
            Preferences are saved per user and persist across sessions.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '10px 22px' }}
        >
          {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? <><CheckCircle size={16} /> Saved!</> : <><Save size={16} /> Save</>}
        </button>
      </div>

      {/* Appearance */}
      <Section icon={<Palette size={18} />} title="Appearance">
        <Field label="Theme" help="Choose a professional palette for the studio. Save to keep it across sessions.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
            {THEME_OPTIONS.map(theme => {
              const active = settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => update('theme', theme.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{theme.name}</span>
                    {active && <CheckCircle size={14} color="var(--accent-primary)" />}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                    {theme.colors.map(color => (
                      <span
                        key={color}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '999px',
                          background: color,
                          border: '1px solid var(--border-color)'
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {theme.description}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      {/* Ollama Connection */}
      <Section icon={<Server size={18} />} title="Ollama Connection">
        <Field label="Ollama Host URL" help="The address of your Ollama instance. Change this if Ollama is running on a different machine or port.">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              style={{ flex: 1 }}
              value={settings.ollamaHost}
              onChange={e => update('ollamaHost', e.target.value)}
              placeholder="http://127.0.0.1:11434"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              {ollamaStatus === 'checking' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {ollamaStatus === 'online' && <CheckCircle size={13} color="var(--success)" />}
              {ollamaStatus === 'offline' && <AlertCircle size={13} color="var(--danger)" />}
              <span style={{ color: ollamaStatus === 'online' ? 'var(--success)' : ollamaStatus === 'offline' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {ollamaStatus === 'online' ? `Online · ${models.length} models` : ollamaStatus === 'offline' ? 'Offline' : 'Checking...'}
              </span>
            </div>
          </div>
        </Field>
      </Section>

      {/* Chat Settings */}
      <Section icon={<MessageSquare size={18} />} title="Chat">
        <Field label="Platform Selection" help="Choose where main chat models come from. Hybrid merges local Ollama models with discoverable Hugging Face models in one picker.">
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { value: 'ollama', label: 'Ollama', sub: 'Local-only models' },
              { value: 'huggingface', label: 'Hugging Face', sub: 'HF router or HF-compatible endpoint' },
              { value: 'hybrid', label: 'Hybrid', sub: 'Merge Ollama + Hugging Face' },
            ].map(opt => {
              const active = settings.chatPlatform === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('chatPlatform', opt.value as ChatPlatform)}
                  style={{
                    flex: 1,
                    minWidth: '150px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>{opt.label}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </Field>

        {(settings.chatPlatform === 'huggingface' || settings.chatPlatform === 'hybrid') && (
          <>
            <Field label="Hugging Face Base URL" help="Default is the official Hugging Face router. You can also point this at a local HF-compatible serving endpoint such as TGI, vLLM, or SGLang if it exposes OpenAI-style chat completions.">
              <input
                className="input-field"
                value={settings.huggingFaceBaseUrl}
                onChange={e => update('huggingFaceBaseUrl', e.target.value)}
                placeholder={DEFAULT_HUGGING_FACE_BASE_URL}
              />
            </Field>

            <Field label="Hugging Face Token" help="Stored only in this browser. Required for the default Hugging Face router; custom local endpoints may not need it.">
              <input
                className="input-field"
                type="password"
                value={huggingFaceApiKey}
                onChange={e => persistHuggingFaceApiKey(e.target.value)}
                placeholder="hf_..."
                autoComplete="off"
              />
            </Field>
          </>
        )}

        <Field
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Local Model Lifecycle
              <HelpHint text="PeakUI now leaves model loading and unload timing to Ollama itself. Use the Stop model button in Chat or Open Claw when you want to force a clean reload." />
            </span>
          }
          help="Chat and local-provider Open Claw no longer override Ollama keep-alive or prewarm models in the background."
        >
          <div style={{
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-glass)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '6px' }}>
              Native Ollama behavior
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              PeakUI no longer sends request-level <code>keep_alive</code> values or background warmup prompts for Chat and local-provider Open Claw. If a model gets wedged, use the header-level <strong>Stop model</strong> control to unload it and let the next request start cleanly.
            </div>
          </div>
        </Field>

        <Field
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Exclusive Ollama Switching
              <HelpHint text="Before a local Chat or Open Claw request starts, unload any other running Ollama models so the selected model gets the machine to itself." />
            </span>
          }
          help="When enabled, the app asks Ollama to unload other running models before it starts the selected local chat model."
        >
          <button
            type="button"
            onClick={() => update('exclusiveOllamaModels', !settings.exclusiveOllamaModels)}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: '12px',
              border: `1px solid ${settings.exclusiveOllamaModels ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              background: settings.exclusiveOllamaModels ? 'var(--accent-soft)' : 'var(--bg-glass)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                {settings.exclusiveOllamaModels ? 'Exclusive model mode enabled' : 'Exclusive model mode disabled'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.45 }}>
                {settings.exclusiveOllamaModels
                  ? 'Other running Ollama models are unloaded before the selected Ollama chat model starts.'
                  : 'Ollama is free to leave other recently-used local models resident until they expire.'}
              </div>
            </div>
            <div style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: settings.exclusiveOllamaModels ? 'var(--accent-primary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap'
            }}>
              {settings.exclusiveOllamaModels ? 'Only one' : 'Shared'}
            </div>
          </button>
        </Field>

        <Field label="Default Chat Model" help="This model is pre-selected when you open the chat. You can still change it per-session from the header dropdown.">
          {visibleChatModels.length > 0 ? (
            <select
              className="input-field"
              value={selectedChatModelId}
              onChange={e => {
                const nextModel = visibleChatModels.find(model => model.id === e.target.value)
                if (!nextModel) {
                  update('chatModel', '')
                  return
                }
                update('chatModel', nextModel.name)
                if (nextModel) {
                  update('chatModelProvider', nextModel.provider)
                }
              }}
              style={{ width: '100%' }}
            >
              <option value="">— Pick from header each time —</option>
              {visibleChatModels.map(model => (
                <option key={model.id} value={model.id}>
                  {model.provider === 'ollama' ? `[Ollama] ${model.name}` : `[Hugging Face] ${model.name}`}
                </option>
              ))}
            </select>
          ) : settings.chatPlatform === 'huggingface' ? (
            <input
              className="input-field"
              value={settings.chatModel}
              onChange={e => {
                update('chatModel', e.target.value)
                update('chatModelProvider', 'huggingface')
              }}
              placeholder="deepseek-ai/DeepSeek-R1:fastest"
            />
          ) : (
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {chatModelsLoading ? 'Loading chat models…' : 'No chat models were discovered for the selected platform yet.'}
            </div>
          )}
          {needsHuggingFaceTokenForDiscovery && (
            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Add a Hugging Face token to list router models automatically. In Hugging Face-only mode, you can still type a model id manually if you already know the exact name.
            </div>
          )}
        </Field>

        <Field label="System Prompt" help="A persistent instruction prepended to every conversation. Useful for setting a persona or behavioral rules.">
          <textarea
            className="input-field"
            rows={4}
            value={settings.systemPrompt}
            onChange={e => update('systemPrompt', e.target.value)}
            placeholder="You are a helpful assistant that is concise and direct..."
            style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
        </Field>

        <Field label={`Temperature: ${settings.temperature.toFixed(1)}`} help="Controls randomness. Lower = focused and deterministic. Higher = creative and varied. (0.0 – 2.0)">
          <input
            type="range"
            min="0" max="2" step="0.1"
            value={settings.temperature}
            onChange={e => update('temperature', parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            <span>0.0 — Precise</span><span>1.0 — Balanced</span><span>2.0 — Creative</span>
          </div>
        </Field>

        <Field label={`Context Window: ${settings.contextLength.toLocaleString()} tokens`} help="Requested maximum for local Ollama. The server applies a safe request cap by default and backs off on memory pressure.">
          <input
            type="range"
            min="512" max="131072" step="512"
            value={settings.contextLength}
            onChange={e => update('contextLength', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            <span>512</span><span>32k</span><span>128k</span>
          </div>
        </Field>
      </Section>

      <Section icon={<Bot size={18} />} title="Open Claw">
        <Field label="Provider" help="Start with local Ollama models. OpenAI-compatible providers can be wired in without changing the workspace later.">
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { value: 'ollama', label: 'Local Ollama' },
              { value: 'openai-compatible', label: 'OpenAI-compatible' },
            ].map(opt => {
              const active = settings.openClawProvider === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawProvider', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        {settings.openClawProvider === 'openai-compatible' && (
          <Field label="API Base URL" help="For example: https://api.openai.com/v1 or a local proxy endpoint.">
            <input
              className="input-field"
              value={settings.openClawBaseUrl}
              onChange={e => update('openClawBaseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        )}

        <Field label="Open Claw Model" help="This model is remembered for the Open Claw workspace and reused automatically on return.">
          {settings.openClawProvider === 'ollama' ? (
            <select
              className="input-field"
              value={settings.openClawModel}
              onChange={e => update('openClawModel', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Pick a local model —</option>
              {models.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="input-field"
              value={settings.openClawModel}
              onChange={e => update('openClawModel', e.target.value)}
              placeholder="gpt-4o-mini"
            />
          )}
        </Field>

        <Field label="Shell Target" help="Choose whether Open Claw shell commands run inside the app container or on the host machine through the optional host executor.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {([
              { value: 'container', label: 'Container', desc: 'Use the built-in runtime container shell' },
              { value: 'host', label: 'Host', desc: 'Use the optional host executor service' },
            ] as const).map(opt => {
              const active = settings.shellExecutionTarget === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('shellExecutionTarget', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Shell Approval Mode" help="Auto-approve runs simple allowlisted commands immediately and asks for approval on everything else. Ask First prompts before every non-blocked command.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Allowlisted commands run automatically; the rest require approval' },
              { value: 'ask-first', label: 'Ask First', desc: 'Approve each command' },
              { value: 'deny', label: 'Deny All', desc: 'Block all commands' },
            ].map(opt => {
              const active = settings.shellExecutionMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('shellExecutionMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Additional Allowed Commands" help="Comma-separated list of commands to allow (safe defaults like ls, git, npm are always allowed).">
          <input
            className="input-field"
            value={settings.shellAllowedCommands}
            onChange={e => update('shellAllowedCommands', e.target.value)}
            placeholder="docker-compose, make, go build"
          />
        </Field>

        {settings.shellExecutionTarget === 'host' && settings.shellExecutionMode !== 'deny' && (
          <>
            <Field label="Host Shell Allowed Roots" help="One absolute host path per line. Host shell commands must start in one of these approved roots. This constrains the working directory, not every possible file access inside an arbitrary shell command.">
              <textarea
                className="input-field"
                rows={4}
                value={settings.shellHostAllowedRoots}
                onChange={e => update('shellHostAllowedRoots', e.target.value)}
                placeholder={`/tmp/peakui-openclaw-workspace\n/home/raza/Desktop`}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
              />
            </Field>

            <Field label="Host Shell Allowed Env Vars" help="One host environment variable per line. Only these names are exposed to host shell commands, plus a minimal fixed runtime environment.">
              <textarea
                className="input-field"
                rows={4}
                value={settings.shellHostAllowedEnvVars}
                onChange={e => update('shellHostAllowedEnvVars', e.target.value)}
                placeholder={`PATH\nHOME\nUSER\nSHELL`}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <Field label="Host Shell Timeout (ms)" help="Maximum execution time per host shell command.">
                <input
                  className="input-field"
                  type="number"
                  min={1000}
                  max={300000}
                  value={settings.shellHostMaxTimeoutMs}
                  onChange={e => update('shellHostMaxTimeoutMs', Number(e.target.value))}
                />
              </Field>

              <Field label="Host Output Cap (bytes)" help="Maximum combined stdout/stderr returned from a host shell command.">
                <input
                  className="input-field"
                  type="number"
                  min={16384}
                  max={1048576}
                  value={settings.shellHostMaxOutputBytes}
                  onChange={e => update('shellHostMaxOutputBytes', Number(e.target.value))}
                />
              </Field>
            </div>
          </>
        )}

        <Field label="Filesystem Access" help="Grant Open Claw read-only access to approved host paths. This is separate from shell execution and never permits writes.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'read-only', label: 'Read-only', desc: 'Allow Open Claw to inspect approved host files and directories' },
              { value: 'deny', label: 'Deny', desc: 'Block host filesystem access entirely' },
            ].map(opt => {
              const active = settings.openClawFileAccessMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawFileAccessMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Approved Host Paths" help="One absolute host path per line. Open Claw can only read inside these approved roots.">
          <textarea
            className="input-field"
            rows={5}
            value={settings.openClawAllowedPaths}
            onChange={e => update('openClawAllowedPaths', e.target.value)}
            placeholder={`/home\n/tmp`}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            This deployment currently mounts the host <code>/home</code> tree and <code>/tmp</code> into the app container in read-only mode. Approve a broad root like <code>/home</code> if you want Open Claw to inspect user directories, or approve a narrower subfolder if you want tighter scope.
          </div>
        </Field>

        <Field label="Filesystem Writes" help="Control whether Open Claw can create folders or write text files inside approved writable roots.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block file creation and edits entirely' },
              { value: 'ask-first', label: 'Ask First', desc: 'Require approval before each write or mkdir action' },
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Automatically allow writes inside approved writable roots' },
            ].map(opt => {
              const active = settings.openClawFileWriteMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawFileWriteMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Approved Writable Roots" help="One absolute host path per line. Open Claw can only create files, edit files, or make folders inside these roots.">
          <textarea
            className="input-field"
            rows={4}
            value={settings.openClawWritablePaths}
            onChange={e => update('openClawWritablePaths', e.target.value)}
            placeholder={`/tmp/peakui-openclaw-workspace`}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            The default managed workspace root is mounted read-write for Open Claw. If you want broader writable scope later, add an explicit Docker bind mount first, then approve only the narrowest host root you actually want the agent to edit.
          </div>
        </Field>

        <Field label="Code Execution Sandbox" help="Run short Python or Node scripts in a managed Open Claw workspace with timeouts, output caps, and approval gates.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all code execution' },
              { value: 'ask-first', label: 'Ask First', desc: 'Require approval before each code run' },
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Automatically run sandbox requests in the managed workspace' },
            ].map(opt => {
              const active = settings.openClawCodeExecutionMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawCodeExecutionMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Browser Control" help="Allow Open Claw to browse public websites, inspect links/forms, and optionally submit forms with approval.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all browser actions' },
              { value: 'read-only', label: 'Read-only', desc: 'Allow navigation and scraping, but block form fill/submit actions' },
              { value: 'ask-first', label: 'Ask First', desc: 'Allow navigation and require approval before form submits' },
            ].map(opt => {
              const active = settings.openClawBrowserMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawBrowserMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            Browser control is limited to public <code>http</code>/<code>https</code> pages. Local network targets, non-standard ports, and private hosts are blocked by design.
          </div>
        </Field>

        <Field label="UWAF Browser" help="Unified Web Agent Framework: dual-mode browser that supports both Clear Web (direct) and Dark Web (Tor) research with sanitization and screenshots.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all UWAF browser actions' },
              { value: 'direct', label: 'Direct', desc: 'Clear web only — standard browsing with sanitization' },
              { value: 'stealth', label: 'Stealth', desc: 'Tor-routed anonymous browsing including .onion sites' },
            ].map(opt => {
              const active = settings.openClawUwafBrowserMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawUwafBrowserMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? (opt.value === 'stealth' ? '#a855f7' : 'var(--accent-primary)') : 'var(--border-color)'}`,
                    background: active ? (opt.value === 'stealth' ? 'rgba(168, 85, 247, 0.1)' : 'var(--accent-soft)') : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {settings.openClawUwafBrowserMode !== 'deny' && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Field label="Default Mode" help="Set whether the UWAF browser defaults to Direct (Clear Web) or Stealth (Tor-routed) mode.">
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'direct', label: 'Direct (Clear Web)' },
                    { value: 'stealth', label: 'Stealth (Tor)' },
                  ].map(opt => {
                    const active = settings.openClawUwafDefaultMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => update('openClawUwafDefaultMode', opt.value)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '0.8rem',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Screenshots" help="Automatically capture viewport screenshots when browsing pages.">
                <div
                  onClick={() => update('openClawUwafScreenshots', !settings.openClawUwafScreenshots)}
                  style={{
                    position: 'relative', width: '48px', height: '26px', borderRadius: '13px',
                    background: settings.openClawUwafScreenshots ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '3px',
                    left: settings.openClawUwafScreenshots ? '25px' : '3px',
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                  }} />
                </div>
              </Field>
              <Field label="Live Browser" help="Launch a real interactive browser surface in the sidebar. When enabled, you can watch the actual browser session live and take over control using the Take Over button. Static screenshots remain available separately when live browser is disabled or unavailable.">
                <div
                  onClick={() => update('openClawUwafLiveBrowser', !settings.openClawUwafLiveBrowser)}
                  style={{
                    position: 'relative', width: '48px', height: '26px', borderRadius: '13px',
                    background: settings.openClawUwafLiveBrowser ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '3px',
                    left: settings.openClawUwafLiveBrowser ? '25px' : '3px',
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                  }} />
                </div>
              </Field>
            </div>
          )}
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            UWAF browser renders pages with a real browser engine, sanitizes content to Markdown, and blocks executable downloads. Stealth mode requires a running Tor proxy (tor-proxy service in Docker Compose).
          </div>
        </Field>
      </Section>

      {/* Knowledge Base / RAG Settings */}
      <Section icon={<Database size={18} />} title="Knowledge Base (RAG)">
        <Field label="Enable Knowledge Base" help="When enabled, relevant content from your indexed documents will be automatically included in chat responses.">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              onClick={() => update('ragEnabled', !settings.ragEnabled)}
              style={{
                position: 'relative', width: '48px', height: '26px', borderRadius: '13px',
                background: settings.ragEnabled ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.2s',
                border: `1px solid ${settings.ragEnabled ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              }}
            >
              <div style={{
                position: 'absolute', top: '3px', left: settings.ragEnabled ? '26px' : '3px',
                width: '18px', height: '18px', borderRadius: '50%',
                background: settings.ragEnabled ? 'var(--bg-primary)' : 'var(--text-secondary)',
                transition: 'all 0.2s',
              }} />
            </div>
            <span style={{ fontSize: '0.82rem', color: settings.ragEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
              {settings.ragEnabled ? 'Enabled — knowledge base will be queried during chat' : 'Disabled — knowledge base will not be used in chat'}
            </span>
          </div>
        </Field>

        <Field label="Search Results (topK)" help="Number of document chunks to retrieve for each query. Higher values = more context but more tokens. Use 'Full Access' to retrieve all matching chunks.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max={settings.ragTopK === -1 ? 50 : 50}
                value={settings.ragTopK === -1 ? 50 : settings.ragTopK}
                onChange={e => update('ragTopK', Math.round(Number(e.target.value)))}
                style={{ flex: 1 }}
                disabled={settings.ragTopK === -1}
              />
              <input
                type="number"
                min="1"
                max="200"
                value={settings.ragTopK === -1 ? 50 : settings.ragTopK}
                onChange={e => {
                  const val = Math.round(Number(e.target.value));
                  update('ragTopK', val >= 1 && val <= 200 ? val : 8);
                }}
                style={{
                  width: '56px', padding: '6px 8px', borderRadius: '8px',
                  background: 'var(--bg-glass)', border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)', fontSize: '0.85rem', textAlign: 'center',
                }}
                disabled={settings.ragTopK === -1}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                onClick={() => update('ragTopK', settings.ragTopK === -1 ? 8 : -1)}
                style={{
                  position: 'relative', width: '44px', height: '24px', borderRadius: '12px',
                  background: settings.ragTopK === -1 ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                  cursor: 'pointer', transition: 'all 0.2s',
                  border: `1px solid ${settings.ragTopK === -1 ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: '2px', left: settings.ragTopK === -1 ? '24px' : '2px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: settings.ragTopK === -1 ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  transition: 'all 0.2s',
                }} />
              </div>
              <span style={{ fontSize: '0.78rem', color: settings.ragTopK === -1 ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                {settings.ragTopK === -1
                  ? 'Full Access ON — retrieving ALL matching chunks (may use significant tokens)'
                  : 'Full Access OFF — limit chunks to selected count above'}
              </span>
            </div>
          </div>
        </Field>

        <Field label="RAG Search Mode" help="Semantic uses an embedding model for accurate meaning-based search. Keyword uses BM25 text matching — no extra model needed.">
          <div style={{ display: 'flex', gap: '10px' }}>
            {[
              { value: 'semantic', label: '🧠 Semantic', sub: 'Requires embedding model' },
              { value: 'keyword', label: '🔤 Keyword (BM25)', sub: 'No extra model needed' }
            ].map(opt => (
              <div
                key={opt.value}
                onClick={() => update('ragMode', opt.value)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer',
                  border: `1px solid ${settings.ragMode === opt.value ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: settings.ragMode === opt.value ? 'var(--accent-soft)' : 'var(--bg-glass)',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '2px' }}>{opt.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{opt.sub}</div>
              </div>
            ))}
          </div>
        </Field>

        {settings.ragMode === 'semantic' && (
          <>
            <Field label="Embedding Model" help="The Ollama model used to generate vector embeddings for your documents. Smaller models are faster; larger or multilingual models usually improve recall.">
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  className="input-field"
                  value={settings.ragModel}
                  onChange={e => { update('ragModel', e.target.value); setEmbedStatus('idle'); }}
                  style={{ flex: 1 }}
                >
                  {RECOMMENDED_EMBEDDING_MODELS.map(model => (
                    <option key={model.name} value={model.name}>
                      {model.name}{installedModelKeys.has(ollamaModelKey(model.name)) ? ' · installed' : ' · pull required'}
                    </option>
                  ))}
                  {otherInstalledModels.length > 0 && (
                    <option disabled>── Other installed models ──</option>
                  )}
                  {otherInstalledModels.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}
                  onClick={handleTestEmbedding}
                  disabled={testingEmbed}
                >
                  {testingEmbed ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Test'}
                </button>
              </div>
              {embedStatus === 'ok' && (
                <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.78rem', color: 'var(--success)' }}>
                  <CheckCircle size={13} /> Model is available and working{embedDetails ? ` (${embedDetails})` : ''}
                </div>
              )}
              {embedStatus === 'error' && (
                <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.78rem', color: '#fca5a5' }}>
                  <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{embedError || `Not available. Run: ollama pull ${settings.ragModel}`}</span>
                    <button
                      className="btn btn-secondary"
                      style={{ alignSelf: 'flex-start', padding: '6px 10px', fontSize: '0.75rem' }}
                      onClick={() => update('ragMode', 'keyword')}
                    >
                      Use Keyword/BM25
                    </button>
                  </div>
                </div>
              )}
            </Field>

            <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <strong>Recommended embedding models:</strong>
              <div style={{ marginTop: '6px' }}>
                Pick a smaller model for speed and a larger or multilingual model when you want better retrieval quality on bigger libraries.
              </div>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {RECOMMENDED_EMBEDDING_MODELS.map(m => {
                  const installed = installedModelKeys.has(ollamaModelKey(m.name));
                  return (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: '0.78rem', color: 'var(--accent-primary)' }}>{m.name}</code>
                    <span>{m.size} · {m.note} · {installed ? 'installed' : 'pull required'}</span>
                  </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                Pull the selected model with: <code style={{ color: 'var(--accent-primary)' }}>ollama pull {settings.ragModel}</code>. If the test times out, switch to Keyword/BM25 or restart Ollama before using Semantic mode.
              </div>
            </div>
          </>
        )}

        {settings.ragMode === 'keyword' && (
          <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <CheckCircle size={14} color="var(--success)" style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <strong style={{ color: 'var(--success)' }}>No embedding model required.</strong> BM25 keyword search will be used. Documents you upload will be indexed immediately without calling any Ollama model.
          </div>
        )}
      </Section>

      {/* About */}
      <Section icon={<Bot size={18} />} title="About PeakUI">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {[
            { label: 'Version', value: '1.0.0' },
            { label: 'Database', value: 'PostgreSQL' },
            { label: 'ORM', value: 'Prisma' },
            { label: 'Framework', value: 'Next.js 16' },
          ].map(item => (
            <div key={item.label} style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{item.label}</div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
