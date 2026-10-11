'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CornerDownLeft, Delete, Keyboard, RotateCw } from 'lucide-react';
import { PREVIEW_VIEWPORTS, type PreviewDevice } from '@/lib/coder-preview';

const KEYBOARD_BUFFER = '\u200B\u200B';

function resetKeyboardBuffer(field: HTMLTextAreaElement) {
  field.value = KEYBOARD_BUFFER;
  field.setSelectionRange(1, 1);
}

function bufferedText(value: string) {
  const first = value.indexOf('\u200B');
  const last = value.lastIndexOf('\u200B');
  return first >= 0 && last > first ? value.slice(first + 1, last) : value.replaceAll('\u200B', '');
}

export async function coderBrowserRequest(sessionId: string, input: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch('/api/coder/browser', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, sessionId }), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Coder browser is unavailable.');
  return result;
}

export default function CoderBrowser({ sessionId, url, device, reloadKey }: {
  sessionId: string; url: string; device: PreviewDevice; reloadKey: number;
}) {
  const [frame, setFrame] = useState('');
  const [error, setError] = useState('');
  const [currentUrl, setCurrentUrl] = useState(url);
  const screen = useRef<HTMLImageElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const pendingMove = useRef<Record<string, unknown> | null>(null);
  const moving = useRef(false);
  const lastClick = useRef<{ x: number; y: number; at: number; count: number; button: number } | null>(null);
  const clickCount = useRef(1);
  const touchDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const composing = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const viewport = PREVIEW_VIEWPORTS[device];
  const action = useCallback((input: Record<string, unknown>) => {
    const next = queue.current.catch(() => {}).then(() => coderBrowserRequest(sessionId, input));
    queue.current = next;
    void next.then(result => { setCurrentUrl(result.url || ''); setError(''); }).catch(err => setError(err.message));
    return next;
  }, [sessionId]);
  const focusKeyboard = () => {
    keyboard.current?.focus({ preventScroll: true });
    if (keyboard.current) resetKeyboardBuffer(keyboard.current);
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await coderBrowserRequest(sessionId, { action: 'frame' }, controller.signal);
        if (active) { setFrame(`data:image/jpeg;base64,${result.data}`); setCurrentUrl(result.url); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Browser disconnected'); }
      if (active) timer = setTimeout(poll, 120);
    };
    void action({ action: 'navigate', url, device, navigationId: reloadKey }).catch(() => {}).then(() => { if (active) { setFrame(''); void poll(); } });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [sessionId, url, reloadKey, action]); // viewport changes must not reload the app

  useEffect(() => { void action({ action: 'diagnostics', device }).catch(() => {}); }, [device, action]);

  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      void action({ action: 'scroll', deltaX: event.deltaX, deltaY: event.deltaY }).catch(() => {});
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [!!frame, action]);

  const sendMove = (input: Record<string, unknown>) => {
    pendingMove.current = input;
    if (moving.current) return;
    moving.current = true;
    void (async () => {
      while (pendingMove.current) {
        const latest = pendingMove.current;
        pendingMove.current = null;
        await action(latest).catch(() => {});
      }
      moving.current = false;
    })();
  };
  const pointer = (event: React.PointerEvent<HTMLImageElement>, kind: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (kind === 'down') {
      pendingMove.current = null;
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const touch = event.pointerType === 'touch';
    if (touch) {
      if (kind === 'down') { touchDrag.current = { x: event.clientX, y: event.clientY, moved: false }; return; }
      const drag = touchDrag.current;
      if (kind === 'move' && drag) {
        const dx = drag.x - event.clientX, dy = drag.y - event.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 6) {
          drag.moved = true; drag.x = event.clientX; drag.y = event.clientY;
          void action({ action: 'scroll', deltaX: dx * viewport.width / rect.width, deltaY: dy * viewport.height / rect.height }).catch(() => {});
        }
        return;
      }
      if (kind === 'up') {
        touchDrag.current = null;
        if (drag?.moved) return;
        // Mobile browsers only open their software keyboard during the tap's
        // synchronous gesture. Waiting for the remote editable check is too late.
        focusKeyboard();
        void action({ action: 'pointer', event: 'down', x: (event.clientX - rect.left) * viewport.width / rect.width,
          y: (event.clientY - rect.top) * viewport.height / rect.height }).catch(() => {});
      }
    }
    const x = (event.clientX - rect.left) * viewport.width / rect.width;
    const y = (event.clientY - rect.top) * viewport.height / rect.height;
    if (kind === 'move') { sendMove({ action: 'pointer', event: kind, x, y }); return; }
    pendingMove.current = null;
    if (kind === 'down' && !touch) {
      const previous = lastClick.current;
      clickCount.current = previous && previous.button === event.button && Date.now() - previous.at < 450
        && Math.abs(previous.x - x) < 5 && Math.abs(previous.y - y) < 5 ? Math.min(previous.count + 1, 3) : 1;
    }
    if (kind === 'up' && !touch) lastClick.current = { x, y, at: Date.now(), count: clickCount.current, button: event.button };
    void action({ action: 'pointer', event: kind, x, y, button: event.button, clickCount: clickCount.current }).then(result => {
        if (kind === 'up' && touch && !result.editable) keyboard.current?.blur();
      }).catch(() => {});
  };
  return <div style={{ width: '100%', minHeight: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6 }}>
      {([{ action: 'back', Icon: ArrowLeft, label: 'Back' }, { action: 'forward', Icon: ArrowRight, label: 'Forward' }, { action: 'reload', Icon: RotateCw, label: 'Reload' }]).map(({ action: name, Icon, label }) =>
        <button key={name} title={label} aria-label={label} onClick={() => void action({ action: name }).catch(() => {})} style={{ background: 'transparent', color: 'inherit', border: 0, cursor: 'pointer' }}><Icon size={16} /></button>)}
      <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{currentUrl}</span>
      <button title="Keyboard" aria-label="Browser keyboard" onClick={focusKeyboard} style={{ marginLeft: 'auto', background: 'transparent', color: 'inherit', border: 0, cursor: 'pointer' }}><Keyboard size={16} /></button>
    </div>
    <div style={{ display: 'flex', gap: 3, padding: '0 6px 5px', overflowX: 'auto' }}>
      {([{ key: 'ArrowLeft', Icon: ArrowLeft, label: 'Move cursor left' }, { key: 'ArrowRight', Icon: ArrowRight, label: 'Move cursor right' },
        { key: 'Backspace', Icon: Delete, label: 'Backspace' }, { key: 'Enter', Icon: CornerDownLeft, label: 'Enter' }]).map(({ key, Icon, label }) =>
        <button key={key} title={label} aria-label={label} onClick={() => { void action({ action: 'key', key }).catch(() => {}); focusKeyboard(); }}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 28, background: 'transparent', border: '1px solid currentColor', borderRadius: 4, color: 'inherit', cursor: 'pointer', opacity: 0.7 }}><Icon size={15} /></button>)}
    </div>
    {error && <div role="alert" style={{ color: '#fca5a5', padding: 8 }}>{error}</div>}
    {!frame && <div role="status" style={{ padding: 24 }}>Connecting to Coder browser...</div>}
    {frame && <img ref={screen} src={frame} alt="Coder browser" tabIndex={0} draggable={false}
      style={{ display: 'block', width: '100%', aspectRatio: `${viewport.width} / ${viewport.height}`, touchAction: 'none', outlineOffset: -2 }}
      onPointerDown={event => pointer(event, 'down')} onPointerUp={event => pointer(event, 'up')}
      onPointerMove={event => pointer(event, 'move')}
      onPointerCancel={event => { if (event.pointerType === 'touch') touchDrag.current = null; else pointer(event, 'up'); }}
      onContextMenu={event => event.preventDefault()}
      onPaste={event => { event.preventDefault(); void action({ action: 'text', text: event.clipboardData.getData('text') }).catch(() => {}); }}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
        event.preventDefault();
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        void action(event.key.length === 1 && event.key.charCodeAt(0) > 127 && !event.ctrlKey && !event.metaKey && !event.altKey
          ? { action: 'text', text: event.key }
          : { action: 'key', key: event.key, modifiers: [event.ctrlKey && 'Control', event.shiftKey && 'Shift', event.altKey && 'Alt', event.metaKey && 'Meta'].filter(Boolean) }).catch(() => {});
      }} />}
    <textarea ref={keyboard} aria-label="Browser keyboard" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      style={{ position: 'fixed', left: 12, bottom: 12, width: 2, height: 24, opacity: 0.01, fontSize: 16, padding: 0, border: 0, zIndex: 1 }}
      onFocus={event => resetKeyboardBuffer(event.currentTarget)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={event => {
        composing.current = false;
        const text = bufferedText(event.currentTarget.value);
        resetKeyboardBuffer(event.currentTarget);
        if (text) void action({ action: 'text', text }).catch(() => {});
      }}
      onInput={event => {
        if (composing.current) return;
        const inputType = (event.nativeEvent as InputEvent).inputType;
        const value = event.currentTarget.value;
        const text = bufferedText(value);
        resetKeyboardBuffer(event.currentTarget);
        if (inputType === 'insertLineBreak' || inputType === 'insertParagraph')
          void action({ action: 'key', key: 'Enter' }).catch(() => {});
        else if (inputType?.startsWith('delete') || value.length < KEYBOARD_BUFFER.length)
          void action({ action: 'key', key: inputType?.includes('Forward') ? 'Delete' : 'Backspace' }).catch(() => {});
        else if (text) void action({ action: 'text', text }).catch(() => {});
      }}
      onPaste={event => {
        event.preventDefault();
        const text = event.clipboardData.getData('text');
        if (text) void action({ action: 'text', text }).catch(() => {});
        resetKeyboardBuffer(event.currentTarget);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.key === 'Process' || event.key === 'Unidentified') return;
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
        if (event.ctrlKey || event.metaKey || event.altKey || (event.key.length > 1 && event.key !== 'Backspace' && event.key !== 'Delete')) {
          event.preventDefault();
          void action({ action: 'key', key: event.key, modifiers: [event.ctrlKey && 'Control', event.shiftKey && 'Shift', event.altKey && 'Alt', event.metaKey && 'Meta'].filter(Boolean) }).catch(() => {});
        }
      }} />
  </div>;
}
