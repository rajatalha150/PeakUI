"use client";

import React from 'react';
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, Globe, Loader2, MessageSquare, Plus, Send, Terminal, Trash2, X } from 'lucide-react';

/** A message in the coding chat, projected from the daemon transcript. */
interface CoderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Delivery acknowledgment for user messages. */
  ack?: 'sending' | 'accepted' | 'queued' | 'error';
  status?: 'streaming' | 'done' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number };
}

interface CoderSession {
  sessionId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  activeWorkState: string;
  isWaitingForPermission: boolean;
  isWaitingForUserQuestion: boolean;
  hasTurnError: boolean;
}

interface CoderSessionListResponse {
  sessions?: CoderSession[];
}

/** A tool activity event (WriteFile, shell, etc.) from the transcript. */
interface ToolActivity {
  id: string;
  title: string;
  status: string;
  detail: string;
  at: number;
}

interface CoderTranscriptEvent {
  type: string;
  data?: {
    sessionUpdate?: string;
    content?: unknown;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    toolCallId?: string;
    status?: string;
    title?: string;
    toolName?: string;
  };
}

interface CoderTranscriptResponse {
  sessionId?: string;
  events?: CoderTranscriptEvent[];
}

interface CoderSessionStatus {
  hasActivePrompt?: boolean;
  activeWorkState?: string;
  isWaitingForPermission?: boolean;
  isWaitingForUserQuestion?: boolean;
  pendingInteractionCount?: number;
  hasTurnError?: boolean;
}

interface CoderSessionCreateResponse {
  sessionId?: string;
  error?: string;
}

interface CoderPromptResponse {
  promptId?: string;
  error?: string;
}

/**
 * CodingView — the futuristic coding environment.
 *
 * Bulletproof UX: every message gets a delivery acknowledgment (sending →
 * accepted/queued → done), a live status bar reflects the daemon's real
 * session state, and a tool-activity feed shows what the agent is actually
 * doing (WriteFile, shell, etc.). Commands queue while the agent works (Claude
 * Code CLI behavior).
 */
export default function CodingView({ onExit }: { onExit?: () => void }) {
  const [sessions, setSessions] = React.useState<CoderSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<CoderChatMessage[]>([]);
  const [composer, setComposer] = React.useState('');
  const [connecting, setConnecting] = React.useState(true);
  const [error, setError] = React.useState('');
  const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
  const [terminalOpen, setTerminalOpen] = React.useState(true);
  const [workspace, setWorkspace] = React.useState('/workspace');
  const [daemonOnline, setDaemonOnline] = React.useState(false);
  // Live session status (from /status).
  const [sessionStatus, setSessionStatus] = React.useState<CoderSessionStatus | null>(null);
  // Tool activity feed (from transcript tool_call events).
  const [toolActivity, setToolActivity] = React.useState<ToolActivity[]>([]);
  // Model selection.
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = React.useState('');
  const [modelLoading, setModelLoading] = React.useState(false);
  // Preview browser.
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState('http://localhost:3000');
  const [previewInput, setPreviewInput] = React.useState('http://localhost:3000');

  const pushTerminal = (line: string) => setTerminalLines(prev => [...prev.slice(-200), line]);

  // Derived: are we busy (active prompt, or waiting for permission/question)?
  const busy = sessionStatus?.hasActivePrompt === true
    || sessionStatus?.isWaitingForPermission === true
    || sessionStatus?.isWaitingForUserQuestion === true;

  // Load local Ollama models for the dropdown.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelLoading(true);
      try {
        const res = await fetch('/api/tags');
        const data = await res.json();
        if (!cancelled && Array.isArray(data.models)) {
          setModels((data.models as Array<{ name: string }>).map(m => ({ id: m.name, name: m.name })));
        }
      } catch {
        // Non-fatal.
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Probe the daemon on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/coder/health');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setDaemonOnline(res.ok && data.status === 'ok');
          setConnecting(false);
          if (!(res.ok && data.status === 'ok')) {
            setError('Coding environment (Qwen Code daemon) is offline. Start the coder container.');
          }
        }
      } catch {
        if (!cancelled) {
          setDaemonOnline(false);
          setConnecting(false);
          setError('Coding environment is unreachable.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshSessions = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/coder/sessions?workspace=${encodeURIComponent(workspace)}`);
      const data = (await res.json().catch(() => ({}))) as CoderSessionListResponse;
      if (Array.isArray(data.sessions)) setSessions(data.sessions);
    } catch {
      // Ignore.
    }
  }, [workspace]);

  // Load sessions whenever daemon/workspace changes.
  React.useEffect(() => {
    if (!daemonOnline) return;
    const t = setTimeout(() => { void refreshSessions(); }, 0);
    return () => clearTimeout(t);
  }, [daemonOnline, workspace, refreshSessions]);

  // Background poller: transcript + status + tool activity, every 1.2s.
  React.useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        // Transcript (messages + tool activity).
        const tRes = await fetch(`/api/coder/session/${activeSessionId}/transcript`);
        if (tRes.status === 404) {
          if (!cancelled) {
            setError('This coding session was closed. Start a new session.');
            setSessionStatus(null);
          }
          return;
        }
        if (tRes.ok) {
          const tData = (await tRes.json().catch(() => ({}))) as CoderTranscriptResponse;
          const events = Array.isArray(tData.events) ? tData.events : [];
          const next: CoderChatMessage[] = [];
          const activities: ToolActivity[] = [];
          let assistantId = 0;
          for (const event of events) {
            const su = event.data?.sessionUpdate;
            const content = event.data?.content;
            const text = content && typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string'
              ? (content as { text: string }).text
              : '';
            if (su === 'user_message_chunk' && text) {
              next.push({ id: `u-${next.length}`, role: 'user', content: text, ack: 'accepted' });
            } else if (su === 'agent_message_chunk' && text) {
              const usage = event.data?.usage;
              next.push({ id: `a-${assistantId++}`, role: 'assistant', content: text, status: 'done', usage });
            } else if (su === 'tool_call') {
              activities.push({
                id: event.data?.toolCallId || `t-${activities.length}`,
                title: event.data?.title || event.data?.toolName || 'tool',
                status: event.data?.status || 'in_progress',
                detail: typeof event.data?.content === 'string' ? event.data.content : '',
                at: Date.now(),
              });
            } else if (su === 'tool_call_update') {
              activities.push({
                id: event.data?.toolCallId || `tu-${activities.length}`,
                title: event.data?.title || event.data?.toolName || 'tool',
                status: event.data?.status || 'update',
                detail: typeof event.data?.content === 'string' ? event.data.content.slice(0, 200) : '',
                at: Date.now(),
              });
            }
          }
          if (!cancelled) {
            setMessages(next);
            setToolActivity(activities.slice(-30).reverse());
          }
        }

        // Status.
        const sRes = await fetch(`/api/coder/session/${activeSessionId}/status`);
        if (sRes.ok) {
          const sData = (await sRes.json().catch(() => ({}))) as CoderSessionStatus;
          if (!cancelled) setSessionStatus(sData);
        }
      } catch {
        // Transient; retry next tick.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1200);
      }
    };

    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeSessionId]);

  const selectSession = (session: CoderSession) => {
    setActiveSessionId(session.sessionId);
    setError('');
    setToolActivity([]);
    setSessionStatus(null);
    // The poller immediately loads transcript + status for this id.
  };

  const newSession = async () => {
    setError('');
    try {
      const res = await fetch('/api/coder/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workspace }),
      });
      const data = (await res.json().catch(() => ({}))) as CoderSessionCreateResponse;
      if (!res.ok || !data.sessionId) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create session');
      }
      setActiveSessionId(data.sessionId);
      setMessages([]);
      setToolActivity([]);
      pushTerminal(`[session] created ${data.sessionId.slice(0, 8)}…`);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session');
    }
  };

  const send = async () => {
    const prompt = composer.trim();
    if (!prompt || !activeSessionId) return;
    const sessionId = activeSessionId;
    setError('');
    setComposer('');

    // Optimistic user message with "sending" ack.
    const msgId = `u-${Date.now()}`;
    const userMsg: CoderChatMessage = { id: msgId, role: 'user', content: prompt, ack: 'sending' };
    setMessages(prev => [...prev, userMsg]);
    pushTerminal(`[prompt] ${prompt.slice(0, 100)}`);

    try {
      const res = await fetch(`/api/coder/session/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: [{ type: 'text', text: prompt }] }),
      });
      const data = (await res.json().catch(() => ({}))) as CoderPromptResponse;
      if (!res.ok || !data.promptId) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Prompt rejected');
      }
      // Update ack → accepted/queued. We can't know queued-vs-active from the
      // response alone; the poller's transcript will reconcile. Mark accepted.
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ack: 'accepted' } : m));
      pushTerminal(`[accepted] ${data.promptId.slice(0, 8)}…`);
      // Refresh status so the "active" state shows immediately.
      const sRes = await fetch(`/api/coder/session/${sessionId}/status`);
      if (sRes.ok) setSessionStatus((await sRes.json().catch(() => ({}))) as CoderSessionStatus);
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ack: 'error' } : m));
      setError(e instanceof Error ? e.message : 'Prompt failed');
      pushTerminal(`[error] ${e instanceof Error ? e.message : 'prompt failed'}`);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await fetch(`/api/coder/session/${sessionId}`, { method: 'DELETE' });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
        setToolActivity([]);
        setSessionStatus(null);
      }
      await refreshSessions();
    } catch {
      // Ignore.
    }
  };

  const switchModel = async (modelId: string) => {
    setSelectedModel(modelId);
    if (!activeSessionId) return;
    try {
      // The daemon's model ids carry an `(openai)` suffix; POST /session/:id/model
      // expects that suffixed form, not the raw Ollama name.
      const suffixed = `${modelId}(openai)`;
      const res = await fetch(`/api/coder/session/${activeSessionId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: suffixed }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        pushTerminal(`[model] switch rejected: ${data.error || res.status}`);
        setError(`Model switch failed: ${data.error || res.status}`);
      } else {
        pushTerminal(`[model] switched to ${modelId}`);
      }
    } catch (e) {
      pushTerminal(`[model] switch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Status label + color.
  const statusLabel = sessionStatus?.isWaitingForUserQuestion ? 'Awaiting your answer'
    : sessionStatus?.isWaitingForPermission ? 'Needs approval'
    : sessionStatus?.hasActivePrompt ? 'Working…'
    : sessionStatus?.hasTurnError ? 'Turn error'
    : sessionStatus?.activeWorkState === 'idle' || sessionStatus === null ? 'Idle'
    : 'Working…';
  const statusColor = sessionStatus?.isWaitingForUserQuestion || sessionStatus?.isWaitingForPermission ? '#f59e0b'
    : sessionStatus?.hasTurnError ? '#ef4444'
    : sessionStatus?.hasActivePrompt ? '#22d3ee'
    : '#34d399';

  const accent = '#22d3ee';
  const magenta = '#e879f9';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(1200px 700px at 70% -10%, rgba(34,211,238,0.08), transparent), radial-gradient(900px 600px at 0% 110%, rgba(232,121,249,0.08), transparent), #070a12',
      color: '#d1d5db', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(6px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, letterSpacing: '0.06em', color: accent }}>
          <Terminal size={18} />
          <span style={{ textTransform: 'uppercase', fontSize: '0.8rem' }}>Coding</span>
        </div>
        <span style={{
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.12)', color: daemonOnline ? '#34d399' : '#f87171',
          background: 'rgba(255,255,255,0.03)', fontFamily: 'ui-monospace, monospace',
        }}>
          {connecting ? 'probing…' : daemonOnline ? 'daemon online' : 'daemon offline'}
        </span>
        {activeSessionId && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px',
            border: `1px solid ${statusColor}`, color: statusColor,
            background: 'rgba(255,255,255,0.03)', fontFamily: 'ui-monospace, monospace',
          }}>
            {busy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Circle size={8} />}
            {statusLabel}
          </span>
        )}
        <input
          value={workspace}
          onChange={e => setWorkspace(e.target.value)}
          placeholder="/workspace"
          title="Project directory (workspace cwd)"
          style={{
            width: 160, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px',
            fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', outline: 'none',
          }}
        />
        <div style={{ flex: 1 }} />
        <select
          value={selectedModel}
          onChange={e => void switchModel(e.target.value)}
          disabled={modelLoading || models.length === 0}
          title="Model for the coding brain (Ollama)"
          style={{
            maxWidth: 220, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px',
            fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none',
          }}
        >
          <option value="">{modelLoading ? 'loading models…' : 'select model'}</option>
          {models.map(m => (
            <option key={m.id} value={m.id} style={{ color: '#111' }}>{m.name}</option>
          ))}
        </select>
        <button onClick={() => setPreviewOpen(o => !o)} style={ghostBtnStyle()}>
          <Globe size={14} /> Preview
        </button>
        <button onClick={() => void newSession()} disabled={!daemonOnline} style={btnStyle(accent)}>
          <Plus size={14} /> New session
        </button>
        {onExit && (
          <button onClick={onExit} style={ghostBtnStyle()}>
            <X size={14} /> Exit
          </button>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Chat / main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {messages.length === 0 && !connecting && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(209,213,219,0.4)', maxWidth: '420px' }}>
                <Bot size={36} style={{ margin: '0 auto 12px', color: accent }} />
                <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '6px' }}>Your coding agent is ready.</div>
                <div style={{ fontSize: '0.84rem' }}>
                  {daemonOnline
                    ? 'Start a session and describe what to build. The agent edits files, runs commands, and explains as it goes.'
                    : 'Start the coder container to bring the brain online.'}
                </div>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex', gap: '10px',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              }}>
                <div style={{ width: 28, height: 28, borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: msg.role === 'user' ? 'rgba(232,121,249,0.15)' : 'rgba(34,211,238,0.12)', color: msg.role === 'user' ? magenta : accent }}>
                  {msg.role === 'user' ? <MessageSquare size={15} /> : <Bot size={16} />}
                </div>
                <div style={{
                  maxWidth: '72%', padding: '10px 14px', borderRadius: '12px',
                  background: msg.role === 'user' ? 'rgba(232,121,249,0.08)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  fontFamily: msg.role === 'assistant' ? 'ui-monospace, monospace' : undefined,
                  fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                  {msg.role === 'user' && msg.ack && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace' }}>
                      {msg.ack === 'sending' && <><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} color="#9ca3af" /> <span style={{ color: '#9ca3af' }}>sending…</span></>}
                      {msg.ack === 'accepted' && <><CheckCircle2 size={11} color="#34d399" /> <span style={{ color: '#34d399' }}>accepted</span></>}
                      {msg.ack === 'queued' && <><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} color="#f59e0b" /> <span style={{ color: '#f59e0b' }}>queued</span></>}
                      {msg.ack === 'error' && <><AlertCircle size={11} color="#ef4444" /> <span style={{ color: '#ef4444' }}>failed</span></>}
                    </div>
                  )}
                  {msg.usage && msg.role === 'assistant' && (
                    <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)' }}>
                      ↑{msg.usage.inputTokens ?? '?'} / ↓{msg.usage.outputTokens ?? '?'} tok
                    </div>
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '0.82rem' }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '10px' }}>
            <textarea
              value={composer}
              onChange={e => setComposer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={activeSessionId ? (busy ? 'Agent is working — type to queue the next command…' : 'Tell the agent what to build…') : 'Create a session first'}
              disabled={!activeSessionId}
              rows={2}
              style={{
                flex: 1, resize: 'none', background: 'rgba(255,255,255,0.03)', color: '#e5e7eb',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 12px',
                fontSize: '0.88rem', fontFamily: 'ui-monospace, monospace', outline: 'none',
              }}
            />
            <button onClick={() => void send()} disabled={!activeSessionId || !composer.trim()}
              style={{ ...btnStyle(accent), alignSelf: 'flex-end' }}>
              <Send size={14} /> {busy ? 'Queue' : 'Run'}
            </button>
          </div>

          {/* Terminal pane (TUI) */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => setTerminalOpen(o => !o)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 20px',
              background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.7)', cursor: 'pointer',
              fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              <Terminal size={13} /> agent activity {terminalOpen ? '▾' : '▸'}
            </button>
            {terminalOpen && (
              <div style={{
                height: 150, overflowY: 'auto', padding: '8px 20px',
                background: 'rgba(0,0,0,0.4)', fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem',
                color: 'rgba(209,213,219,0.65)',
              }}>
                {terminalLines.map((line, idx) => <div key={`l-${idx}`} style={{ whiteSpace: 'pre-wrap', color: 'rgba(209,213,219,0.55)' }}>{line}</div>)}
                {toolActivity.length === 0 && terminalLines.length === 0 && <div style={{ color: 'rgba(209,213,219,0.3)' }}>— no activity yet —</div>}
                {toolActivity.map(t => (
                  <div key={t.id} style={{ display: 'flex', gap: '8px', whiteSpace: 'pre-wrap' }}>
                    <span style={{ color: t.status === 'failed' || t.status === 'error' ? '#ef4444' : t.status === 'completed' || t.status === 'success' ? '#34d399' : '#22d3ee', flexShrink: 0 }}>
                      {t.status === 'in_progress' || t.status === 'running' ? '▸' : t.status === 'failed' || t.status === 'error' ? '✗' : t.status === 'completed' || t.status === 'success' ? '✓' : '·'}
                    </span>
                    <span>
                      <strong style={{ color: '#e5e7eb' }}>{t.title}</strong>
                      {t.detail ? <span style={{ color: 'rgba(209,213,219,0.5)' }}> — {t.detail.slice(0, 160)}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview browser */}
        {previewOpen && (
          <div style={{ width: 380, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Globe size={13} style={{ color: accent }} />
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(209,213,219,0.5)' }}>Preview</span>
              <button onClick={() => setPreviewOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.5)', cursor: 'pointer', padding: 0 }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', padding: '8px 10px' }}>
              <input
                value={previewInput}
                onChange={e => setPreviewInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setPreviewUrl(previewInput.trim() || 'http://localhost:3000'); }}
                placeholder="http://localhost:3000"
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 8px',
                  fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none',
                }}
              />
              <button onClick={() => setPreviewUrl(previewInput.trim() || 'http://localhost:3000')}
                style={{ background: 'rgba(34,211,238,0.12)', color: accent, border: `1px solid ${accent}`, borderRadius: '6px', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer' }}>
                Go
              </button>
            </div>
            <iframe
              src={previewUrl}
              title="App preview"
              style={{ flex: 1, border: 'none', background: '#fff' }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}

        {/* Session sidebar */}
        <div style={{ width: 260, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 14px', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(209,213,219,0.5)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            Sessions
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessions.length === 0 && (
              <div style={{ padding: '14px', fontSize: '0.78rem', color: 'rgba(209,213,219,0.4)' }}>
                No sessions yet.
              </div>
            )}
            {sessions.map(session => (
              <div key={session.sessionId} onClick={() => selectSession(session)}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderLeft: activeSessionId === session.sessionId ? `3px solid ${accent}` : '3px solid transparent',
                  background: activeSessionId === session.sessionId ? 'rgba(34,211,238,0.06)' : 'transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ChevronRight size={12} style={{ color: 'rgba(209,213,219,0.4)' }} />
                  <span style={{ fontSize: '0.8rem', color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.displayName || session.sessionId.slice(0, 8)}
                  </span>
                  <button onClick={e => { e.stopPropagation(); void deleteSession(session.sessionId); }}
                    style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', padding: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)', marginTop: '2px', fontFamily: 'ui-monospace, monospace' }}>
                  {session.activeWorkState || 'idle'}
                  {session.isWaitingForPermission ? ' · needs approval' : ''}
                  {session.isWaitingForUserQuestion ? ' · awaiting answer' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function btnStyle(accent: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(34,211,238,0.12)', color: accent,
    border: `1px solid ${accent}`, borderRadius: '8px',
    padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'transparent', color: 'rgba(209,213,219,0.7)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    padding: '7px 12px', fontSize: '0.78rem', cursor: 'pointer',
  };
}
