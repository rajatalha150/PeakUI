// @vitest-environment jsdom

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CoderModelPicker from './CoderModelPicker';

const longName = 'provider/very-long-model-name-with-a-context-window-and-specialized-tools:latest';
const models = [
  { id: 'long', name: longName, toolsCapable: true, visionCapable: true },
  { id: 'text', name: 'Text-only model', toolsCapable: true, visionCapable: false },
];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  React.act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(theme: 'midnight' | 'chatgpt' | 'sage', value = 'long', requireVision = false, onChange = vi.fn(), allowClear = true) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  React.act(() => root?.render(
    <CoderModelPicker
      value={value}
      models={models}
      loading={false}
      onChange={onChange}
      placeholder="Same as main"
      label="Test model"
      theme={theme}
      accent="#10a37f"
      requireVision={requireVision}
      allowClear={allowClear}
    />,
  ));
  return onChange;
}

describe('CoderModelPicker', () => {
  it.each(['midnight', 'chatgpt', 'sage'] as const)('shows complete names in the %s theme', theme => {
    render(theme);
    const trigger = host?.querySelector('[role="combobox"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain(longName);
    expect(trigger.querySelector('span')?.style.overflowWrap).toBe('anywhere');
    React.act(() => trigger.click());
    expect(host?.querySelector('[role="listbox"]')?.textContent).toContain(longName);
    expect(host?.querySelector('[role="listbox"]')?.textContent).toContain('Text-only model');
  });

  it('keeps incompatible models visible but refuses selection', () => {
    const onChange = render('sage', '', true);
    React.act(() => (host?.querySelector('[role="combobox"]') as HTMLButtonElement).click());
    const disabled = [...(host?.querySelectorAll('[role="option"]') || [])].find(option => option.textContent?.includes('Text-only model')) as HTMLButtonElement;
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    React.act(() => disabled.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not offer an empty Main model after a model is selected', () => {
    render('chatgpt', 'long', false, vi.fn(), false);
    React.act(() => (host?.querySelector('[role="combobox"]') as HTMLButtonElement).click());
    expect(host?.querySelectorAll('[role="option"]')).toHaveLength(models.length);
  });

  it('supports keyboard selection and escape', () => {
    const onChange = render('midnight', '');
    const trigger = host?.querySelector('[role="combobox"]') as HTMLButtonElement;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('long');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    React.act(() => trigger.click());
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
