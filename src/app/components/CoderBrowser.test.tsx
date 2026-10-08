// @vitest-environment jsdom

import React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import CoderBrowser from './CoderBrowser';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('focuses the phone keyboard on tap and sends editing keys to Chromium', async () => {
  const actions: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    const action = JSON.parse(String(init.body));
    actions.push(action);
    return new Response(JSON.stringify({ url: 'http://localhost:3000/', data: 'aGVsbG8=', editable: action.action === 'pointer' }), { status: 200 });
  }));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(<CoderBrowser sessionId="owned" url="http://localhost:3000" device="mobile" reloadKey={1} />));
    await vi.waitFor(() => expect(host.querySelector('img')).not.toBeNull());
    const image = host.querySelector('img') as HTMLImageElement;
    image.setPointerCapture = vi.fn();
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) });
    const pointer = (type: string) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 }, clientX: { value: 20 }, clientY: { value: 20 } });
      React.act(() => image.dispatchEvent(event));
    };
    pointer('pointerdown');
    pointer('pointerup');
    const keyboard = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(keyboard);
    await vi.waitFor(() => expect(actions.filter(action => action.action === 'pointer')).toHaveLength(2));
    React.act(() => keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })));
    await vi.waitFor(() => expect(actions.some(action => action.action === 'key' && action.key === 'Backspace')).toBe(true));
    React.act(() => (host.querySelector('[aria-label="Move cursor left"]') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(actions.some(action => action.action === 'key' && action.key === 'ArrowLeft')).toBe(true));
    keyboard.value = 'hello';
    React.act(() => keyboard.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })));
    await vi.waitFor(() => expect(actions.some(action => action.action === 'text' && action.text === 'hello')).toBe(true));
  } finally {
    React.act(() => root.unmount());
    host.remove();
  }
});
