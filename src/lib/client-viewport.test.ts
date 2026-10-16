import { describe, expect, it } from 'vitest';
import { buildClientViewportPrompt, normalizeClientViewport } from './client-viewport';

describe('client viewport presentation context', () => {
  it('accepts only known viewport values', () => {
    expect(normalizeClientViewport('mobile')).toBe('mobile');
    expect(normalizeClientViewport('tablet')).toBe('tablet');
    expect(normalizeClientViewport('desktop')).toBe('desktop');
    expect(normalizeClientViewport('phone')).toBeNull();
    expect(normalizeClientViewport(undefined)).toBeNull();
  });

  it('creates a phone-friendly instruction without changing desktop behavior', () => {
    expect(buildClientViewportPrompt('mobile')).toContain('viewing WorkSpaces on a phone');
    expect(buildClientViewportPrompt('mobile')).toContain('Avoid wide Markdown tables');
    expect(buildClientViewportPrompt('desktop')).toBe('');
  });
});
