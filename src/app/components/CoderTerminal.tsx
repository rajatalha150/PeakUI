'use client';

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Moon, RotateCw, Sun, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

async function terminalCommand(sessionId: string, action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch(`/api/coder/session/${encodeURIComponent(sessionId)}/terminal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Terminal unavailable (${response.status})`);
  }
}

export default function CoderTerminal({ sessionId, workspace, onClose }: {
  sessionId: string; workspace: string; onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [error, setError] = useState('');
  const [light, setLight] = useState(false);
  const [exited, setExited] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!surface.current) return;
    let closed = false;
    let stream: EventSource | null = null;
    let inputQueue = Promise.resolve();
    const term = new Terminal({ cursorBlink: true, convertEol: false, fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 10000, theme: { background: '#101418', foreground: '#e9eff0', cursor: '#80d4bf' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(surface.current);
    terminal.current = term;
    const resize = () => {
      if (closed || !surface.current?.clientWidth || !surface.current?.clientHeight) return;
      fit.fit();
      void terminalCommand(sessionId, 'resize', { cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface.current);
    const input = term.onData(data => {
      inputQueue = inputQueue.then(() => terminalCommand(sessionId, 'write', { data })).catch(err => {
        if (!closed) setError(err.message);
      });
    });
    void (async () => {
      try {
        fit.fit();
        await terminalCommand(sessionId, 'open', { cols: term.cols, rows: term.rows });
        if (closed) return;
        stream = new EventSource(`/api/coder/session/${encodeURIComponent(sessionId)}/terminal`);
        stream.addEventListener('output', event => {
          if (!closed) term.write(JSON.parse((event as MessageEvent).data));
        });
        stream.addEventListener('exit', event => {
          if (!closed) {
            term.writeln(`\r\n[Shell exited: ${JSON.parse((event as MessageEvent).data)}]`);
            setExited(true);
          }
        });
        stream.onerror = () => { if (!closed) setError('Terminal connection interrupted. Reconnecting...'); };
        stream.onopen = () => setError('');
        term.focus();
      } catch (err) { if (!closed) setError(err instanceof Error ? err.message : String(err)); }
    })();
    return () => {
      closed = true;
      stream?.close();
      observer.disconnect();
      input.dispose();
      term.dispose();
      if (terminal.current === term) terminal.current = null;
    };
  }, [sessionId, generation]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = light
      ? { background: '#f7faf8', foreground: '#1d302c', cursor: '#287b66', selectionBackground: '#c8e7d9' }
      : { background: '#101418', foreground: '#e9eff0', cursor: '#80d4bf', selectionBackground: '#27534a' };
  }, [light, generation]);

  const sendKey = (key: string) => terminal.current?.input(key, true);
  return <div role="dialog" aria-label="Coder terminal" style={{ position: 'fixed', inset: '5dvh 3vw', zIndex: 100,
    display: 'flex', flexDirection: 'column', maxWidth: 1100, maxHeight: 780, margin: 'auto', border: '1px solid #57736d',
    background: light ? '#f7faf8' : '#101418', color: light ? '#1d302c' : '#e9eff0', boxShadow: '0 20px 70px #0008' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #738b8555', minHeight: 42 }}>
      <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Terminal · {workspace}</strong>
      {exited && <button aria-label="New shell" title="New shell" onClick={() => { setExited(false); setGeneration(value => value + 1); }} style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}><RotateCw size={17} /></button>}
      <button aria-label={light ? 'Dark terminal' : 'Light terminal'} title={light ? 'Dark terminal' : 'Light terminal'} onClick={() => setLight(!light)} style={{ marginLeft: exited ? 0 : 'auto', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>{light ? <Moon size={17} /> : <Sun size={17} />}</button>
      <button aria-label="Focus terminal keyboard" title="Keyboard" onClick={() => terminal.current?.focus()} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}><Keyboard size={17} /></button>
      <button aria-label="Close terminal" title="Close" onClick={onClose} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}><X size={18} /></button>
    </div>
    {error && <div role="alert" style={{ padding: '4px 12px', fontSize: 12, color: '#e09d80' }}>{error}</div>}
    <div ref={surface} style={{ flex: 1, minHeight: 0, padding: 8, overflow: 'hidden' }} />
    <div style={{ display: 'flex', gap: 4, padding: 5, borderTop: '1px solid #738b8555', overflowX: 'auto' }}>
      {([['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']] as const).map(([label, value]) =>
        <button key={label} onClick={() => { sendKey(value); terminal.current?.focus(); }} style={{ flex: '0 0 auto', padding: '5px 9px', border: '1px solid #738b8577', borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}>{label}</button>)}
    </div>
  </div>;
}
