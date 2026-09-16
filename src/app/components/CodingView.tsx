"use client";

import React from 'react';
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, Globe, Loader2, MessageSquare, Plus, Send, Terminal, Trash2, X } from 'lucide-react';

/** A message in the coding chat, projected from the daemon transcript. */
interface CoderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ack?: 'sending' | 'accepted' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A persistent coding session (stored in the Hermes ChatSession table). */
interface CoderSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CoderChatMessage[];
}

/** A tool activity event (WriteFile, shell, etc.) from the transcript. */
interface ToolActivity {
  id: string;
  title: string;
  status: string;
  detail: string;
}

interface CoderTranscriptEvent {
  type: string;
  data?: {
    sessionUpdate?: string;
    content?: unknown;
    usage?: { inputTokens?: number; outputTokens?: number };
    toolCallId?: string;
    status?: string;
    title?: string;
    toolName?: string;
  };
}

interface CoderSessionStatus {
  hasActivePrompt?: boolean;
  activeWorkState?: string;
  isWaitingForPermission?: boolean;
  isWaitingForUserQuestion?: boolean;
  pendingInteractionCount?: number;
  hasTurnError?: boolean;
}

/** Stored message shape from the Hermes ChatSession table. */
interface StoredMsg {
  id?: string;
  role: string;
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * CodingView — the futuristic coding environment.
 *
 * Session persistence copies the Hermes pattern exactly: coding history is
 * stored in the `ChatSession` table (surface `'coder'`) via `/api/chats`, so
 * sessions survive restarts, can be listed/deleted, and old sessions can be
 * reopened. The Qwen Code daemon session is a transient runtime handle only —
 * its transcript is mirrored into the persistent store after each turn.
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
  const [sessionStatus, setSessionStatus] = React.useState<CoderSessionStatus | null>(null);
  const [toolActivity, setToolActivity] = React.useState<ToolActivity[]>([]);
  // The transient daemon session handle for the active persistent session.
  const [daemonSessionId, setDaemonSessionId] = React.useState<string | null>(null);
  // Model selection.
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = React.useState('');
  const [modelLoading, setModelLoading] = React.useState(false);
  // Preview browser.
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState('http://localhost:3000');
  const [previewInput, setPreviewInput] = React.useState('http://localhost:3000');

  const pushTerminal = (line: string) => setTerminalLines(prev => [...prev.slice(-200), line]);

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

  // ---- Persistent session CRUD (Hermes pattern, surface 'coder') ----------

  const refreshSessions = React.useCallback(async () => {
    try {
      const res = await fetch('/api/chats?surface=coder');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data.map((s: { id: string; title: string; createdAt: string; updatedAt: string }) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messages: [],
        })));
      }
    } catch {
      // Ignore.
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => { void refreshSessions(); }, 0);
    return () => clearTimeout(t);
  }, [refreshSessions]);

  const persistMessages = async (sessionId: string, title: string, msgs: CoderChatMessage[]) => {
    try {
      const stored = msgs.map(m => ({ role: m.role, content: m.content, ...(m.usage ? { usage: m.usage } : {}) }));
      await fetch('/api/chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title, surface: 'coder', messages: stored }),
      });
    } catch {
      // Non-fatal; persistence is best-effort.
    }
  };

  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setError('');
    setToolActivity([]);
    setSessionStatus(null);
    setMessages([]);
    try {
      const res = await fetch(`/api/chats/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        const stored = (Array.isArray(data.messages) ? data.messages : []) as StoredMsg[];
        setMessages(stored
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: m.id || `${m.role}-${Math.random().toString(36).slice(2, 8)}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ...(m.usage ? { usage: m.usage } : {}),
          })));
        pushTerminal(`[history] loaded ${stored.length} messages`);
      } else if (res.status === 404) {
        setError('Session not found.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session');
    }
  };

  const newSession = async () => {
    setError('');
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'coder', title: 'New Coding Session', messages: [] }),
      });
      const data = await res.json().catch(() => ({})) as { session?: { id?: string }; error?: string };
      const id = data.session?.id;
      if (!res.ok || !id) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create session');
      }
      setActiveSessionId(id);
      setMessages([]);
      setToolActivity([]);
      setSessionStatus(null);
      setDaemonSessionId(null);
      pushTerminal(`[session] created ${id.slice(0, 8)}…`);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session');
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/chats', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, surface: 'coder' }),
      });
      if (res.ok) {
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setMessages([]);
          setToolActivity([]);
          setSessionStatus(null);
          setDaemonSessionId(null);
        }
        await refreshSessions();
      } else {
        setError('Failed to delete session');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete session');
    }
  };

  // ---- Daemon runtime handle ------------------------------------------------

  const ensureDaemonSession = async (): Promise<string | null> => {
    if (daemonSessionId) return daemonSessionId;
    try {
      const res = await fetch('/api/coder/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workspace }),
      });
      const data = await res.json().catch(() => ({})) as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to start daemon session');
        return null;
      }
      setDaemonSessionId(data.sessionId);
      pushTerminal(`[daemon] session ${data.sessionId.slice(0, 8)}…`);
      return data.sessionId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start daemon session');
      return null;
    }
  };

  // ---- Send / queue ---------------------------------------------------------

  const send = async () => {
    const prompt = composer.trim();
    if (!prompt || !activeSessionId) return;
    const sessionId = activeSessionId;
    setError('');
    setComposer('');

    const msgId = `u-${Date.now()}`;
    const userMsg: CoderChatMessage = { id: msgId, role: 'user', content: prompt, ack: 'sending' };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    pushTerminal(busy ? `[queued] ${prompt.slice(0, 100)}` : `[prompt] ${prompt.slice(0, 100)}`);

    try {
      const dsid = await ensureDaemonSession();
      if (!dsid) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ack: 'error' } : m));
        return;
      }
      const res = await fetch(`/api/coder/session/${dsid}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: [{ type: 'text', text: prompt }] }),
      });
      const data = await res.json().catch(() => ({})) as { promptId?: string; error?: string };
      if (!res.ok || !data.promptId) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Prompt rejected');
      }
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ack: 'accepted' } : m));
      pushTerminal(`[accepted] ${data.promptId.slice(0, 8)}…`);
      // Persist the user message immediately (title from first message).
      await persistMessages(sessionId, prompt.slice(0, 30), [...messages, { ...userMsg, ack: 'accepted' }]);
      // Refresh status.
      const sRes = await fetch(`/api/coder/session/${dsid}/status`);
      if (sRes.ok) setSessionStatus((await sRes.json().catch(() => ({}))) as CoderSessionStatus);
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ack: 'error' } : m));
      setError(e instanceof Error ? e.message : 'Prompt failed');
      pushTerminal(`[error] ${e instanceof Error ? e.message : 'prompt failed'}`);
    }
  };

  // ---- Background poller: mirror daemon transcript → persistent store -------

  React.useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!daemonSessionId) { timer = setTimeout(poll, 1200); return; }
      try {
        const tRes = await fetch(`/api/coder/session/${daemonSessionId}/transcript`);
        if (tRes.status === 404) {
          if (!cancelled) setSessionStatus(null);
          timer = setTimeout(poll, 1200);
          return;
        }
        if (tRes.ok) {
          const tData = (await tRes.json().catch(() => ({}))) as { events?: CoderTranscriptEvent[] };
          const events = Array.isArray(tData.events) ? tData.events : [];
          const next: CoderChatMessage[] = [];
          const activities: ToolActivity[] = [];
          for (const event of events) {
            const su = event.data?.sessionUpdate;
            const content = event.data?.content;
            const text = content && typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string'
              ? (content as { text: string }).text
              : '';
            if (su === 'user_message_chunk' && text) {
              next.push({ id: `u-${next.length}`, role: 'user', content: text, ack: 'accepted' });
            } else if (su === 'agent_message_chunk' && text) {
              next.push({ id: `a-${next.length}`, role: 'assistant', content: text, usage: event.data?.usage });
            } else if (su === 'tool_call') {
              activities.push({ id: event.data?.toolCallId || `t-${activities.length}`, title: event.data?.title || event.data?.toolName || 'tool', status: event.data?.status || 'in_progress', detail: typeof event.data?.content === 'string' ? event.data.content : '' });
            } else if (su === 'tool_call_update') {
              activities.push({ id: event.data?.toolCallId || `tu-${activities.length}`, title: event.data?.title || event.data?.toolName || 'tool', status: event.data?.status || 'update', detail: typeof event.data?.content === 'string' ? event.data.content.slice(0, 200) : '' });
            }
          }
          if (!cancelled) {
            setMessages(next);
            setToolActivity(activities.slice(-30).reverse());
            // Persist the transcript so history survives restarts.
            const title = next.find(m => m.role === 'user')?.content.slice(0, 30) || 'New Coding Session';
            void persistMessages(activeSessionId, title, next);
          }
        }
        const sRes = await fetch(`/api/coder/session/${daemonSessionId}/status`);
        if (sRes.ok && !cancelled) setSessionStatus((await sRes.json().catch(() => ({}))) as CoderSessionStatus);
      } catch {
        // Transient.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1200);
      }
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeSessionId, daemonSessionId]);

  const switchModel = async (modelId: string) => {
    setSelectedModel(modelId);
    if (!daemonSessionId) return;
    try {
      const suffixed = `${modelId}(openai)`;
      const res = await fetch(`/api/coder/session/${daemonSessionId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: suffixed }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(`Model switch failed: ${data.error || res.status}`);
      } else {
        pushTerminal(`[model] switched to ${modelId}`);
      }
    } catch (e) {
      pushTerminal(`[model] switch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ---- Derived UI state -----------------------------------------------------

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
          style={{ width: 160, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px', fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
        />
        <div style={{ flex: 1 }} />
        <select
          value={selectedModel}
          onChange={e => void switchModel(e.target.value)}
          disabled={modelLoading || models.length === 0}
          title="Model for the coding brain (Ollama)"
          style={{ maxWidth: 220, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
        >
          <option value="">{modelLoading ? 'loading models…' : 'select model'}</option>
          {models.map(m => (<option key={m.id} value={m.id} style={{ color: '#111' }}>{m.name}</option>))}
        </select>
        <button onClick={() => setPreviewOpen(o => !o)} style={ghostBtnStyle()}><Globe size={14} /> Preview</button>
        <button onClick={() => void newSession()} style={btnStyle(accent)}><Plus size={14} /> New session</button>
        {onExit && (<button onClick={onExit} style={ghostBtnStyle()}><X size={14} /> Exit</button>)}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Chat / main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {messages.length === 0 && !connecting && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(209,213,219,0.4)', maxWidth: '420px' }}>
                <Bot size={36} style={{ margin: '0 auto 12px', color: accent }} />
                <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '6px' }}>Your coding agent is ready.</div>
                <div style={{ fontSize: '0.84rem' }}>
                  {daemonOnline ? 'Start a session and describe what to build.' : 'Start the coder container to bring the brain online.'}
                </div>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', gap: '10px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                <div style={{ width: 28, height: 28, borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: msg.role === 'user' ? 'rgba(232,121,249,0.15)' : 'rgba(34,211,238,0.12)', color: msg.role === 'user' ? magenta : accent }}>
                  {msg.role === 'user' ? <MessageSquare size={15} /> : <Bot size={16} />}
                </div>
                <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: '12px', background: msg.role === 'user' ? 'rgba(232,121,249,0.08)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', fontFamily: msg.role === 'assistant' ? 'ui-monospace, monospace' : undefined, fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.content}
                  {msg.role === 'user' && msg.ack && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace' }}>
                      {msg.ack === 'sending' && <><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} color="#9ca3af" /> <span style={{ color: '#9ca3af' }}>sending…</span></>}
                      {msg.ack === 'accepted' && <><CheckCircle2 size={11} color="#34d399" /> <span style={{ color: '#34d399' }}>accepted</span></>}
                      {msg.ack === 'error' && <><AlertCircle size={11} color="#ef4444" /> <span style={{ color: '#ef4444' }}>failed</span></>}
                    </div>
                  )}
                  {msg.usage && msg.role === 'assistant' && (
                    <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)' }}>↑{msg.usage.inputTokens ?? '?'} / ↓{msg.usage.outputTokens ?? '?'} tok</div>
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
              style={{ flex: 1, resize: 'none', background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 12px', fontSize: '0.88rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
            />
            <button onClick={() => void send()} disabled={!activeSessionId || !composer.trim()} style={{ ...btnStyle(accent), alignSelf: 'flex-end' }}>
              <Send size={14} /> {busy ? 'Queue' : 'Run'}
            </button>
          </div>

          {/* Terminal pane */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => setTerminalOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 20px', background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.7)', cursor: 'pointer', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <Terminal size={13} /> agent activity {terminalOpen ? '▾' : '▸'}
            </button>
            {terminalOpen && (
              <div style={{ height: 150, overflowY: 'auto', padding: '8px 20px', background: 'rgba(0,0,0,0.4)', fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', color: 'rgba(209,213,219,0.65)' }}>
                {terminalLines.map((line, idx) => <div key={`l-${idx}`} style={{ whiteSpace: 'pre-wrap', color: 'rgba(209,213,219,0.55)' }}>{line}</div>)}
                {toolActivity.length === 0 && terminalLines.length === 0 && <div style={{ color: 'rgba(209,213,219,0.3)' }}>— no activity yet —</div>}
                {toolActivity.map(t => (
                  <div key={t.id} style={{ display: 'flex', gap: '8px', whiteSpace: 'pre-wrap' }}>
                    <span style={{ color: t.status === 'failed' || t.status === 'error' ? '#ef4444' : t.status === 'completed' || t.status === 'success' ? '#34d399' : '#22d3ee', flexShrink: 0 }}>
                      {t.status === 'in_progress' || t.status === 'running' ? '▸' : t.status === 'failed' || t.status === 'error' ? '✗' : t.status === 'completed' || t.status === 'success' ? '✓' : '·'}
                    </span>
                    <span><strong style={{ color: '#e5e7eb' }}>{t.title}</strong>{t.detail ? <span style={{ color: 'rgba(209,213,219,0.5)' }}> — {t.detail.slice(0, 160)}</span> : null}</span>
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
              <button onClick={() => setPreviewOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.5)', cursor: 'pointer', padding: 0 }}><X size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: '6px', padding: '8px 10px' }}>
              <input value={previewInput} onChange={e => setPreviewInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setPreviewUrl(previewInput.trim() || 'http://localhost:3000'); }} placeholder="http://localhost:3000" style={{ flex: 1, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }} />
              <button onClick={() => setPreviewUrl(previewInput.trim() || 'http://localhost:3000')} style={{ background: 'rgba(34,211,238,0.12)', color: accent, border: `1px solid ${accent}`, borderRadius: '6px', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer' }}>Go</button>
            </div>
            <iframe src={previewUrl} title="App preview" style={{ flex: 1, border: 'none', background: '#fff' }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          </div>
        )}

        {/* Session sidebar (persistent, Hermes pattern) */}
        <div style={{ width: 260, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 14px', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(209,213,219,0.5)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Sessions</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessions.length === 0 && <div style={{ padding: '14px', fontSize: '0.78rem', color: 'rgba(209,213,219,0.4)' }}>No sessions yet.</div>}
            {sessions.map(session => (
              <div key={session.id} onClick={() => void loadSession(session.id)} style={{ padding: '10px 14px', cursor: 'pointer', borderLeft: activeSessionId === session.id ? `3px solid ${accent}` : '3px solid transparent', background: activeSessionId === session.id ? 'rgba(34,211,238,0.06)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ChevronRight size={12} style={{ color: 'rgba(209,213,219,0.4)' }} />
                  <span style={{ fontSize: '0.8rem', color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title || session.id.slice(0, 8)}</span>
                  <button onClick={e => { e.stopPropagation(); void deleteSession(session.id); }} style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', padding: 0 }}><Trash2 size={13} /></button>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)', marginTop: '2px', fontFamily: 'ui-monospace, monospace' }}>{new Date(session.updatedAt || session.createdAt).toLocaleString()}</div>
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
  return { display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(34,211,238,0.12)', color: accent, border: `1px solid ${accent}`, borderRadius: '8px', padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' };
}

function ghostBtnStyle(): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', color: 'rgba(209,213,219,0.7)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '7px 12px', fontSize: '0.78rem', cursor: 'pointer' };
}
