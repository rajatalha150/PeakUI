"use client";

import React from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CoderModelOption {
  id: string;
  name: string;
  toolsCapable: boolean;
  visionCapable: boolean;
}

interface Props {
  value: string;
  models: CoderModelOption[];
  loading: boolean;
  onChange: (id: string) => void;
  placeholder: string;
  label: string;
  theme: 'midnight' | 'chatgpt' | 'sage';
  accent: string;
  requireVision?: boolean;
  allowClear?: boolean;
  align?: 'left' | 'right';
}

export default function CoderModelPicker({ value, models, loading, onChange, placeholder, label, theme, accent, requireVision = false, allowClear = true, align = 'left' }: Props) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const light = theme === 'sage';
  const foreground = light ? '#28453a' : theme === 'chatgpt' ? '#ececec' : '#d1d5db';
  const muted = light ? '#587065' : '#9ca3af';
  const surface = light ? '#ffffff' : theme === 'chatgpt' ? '#303030' : '#111827';
  const border = light ? 'rgba(40,69,58,0.24)' : 'rgba(255,255,255,0.18)';
  const available = (model: CoderModelOption) => requireVision ? model.visionCapable : model.toolsCapable;
  const choices = allowClear ? [{ id: '', name: placeholder, toolsCapable: true, visionCapable: true }, ...models] : models;
  const selected = models.find(model => model.id === value);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const option = document.getElementById(`${listId}-${active}`);
    if (!option) return;
    const list = listRef.current;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [open, active, listId]);

  const move = (direction: number) => {
    let next = active;
    for (let count = 0; count < choices.length; count += 1) {
      next = (next + direction + choices.length) % choices.length;
      if (available(choices[next])) { setActive(next); break; }
    }
  };
  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setActive(Math.max(0, choices.findIndex(choice => choice.id === value))); setOpen(true); }
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (available(choices[active])) choose(choices[active].id);
    }
  };

  return (
    <div ref={rootRef} className="coder-model-picker" style={{ position: 'relative', width: '100%', minWidth: 0 }} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="coder-model-picker-trigger"
        disabled={loading || models.length === 0}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        title={selected?.name || placeholder}
        onClick={() => { setActive(Math.max(0, choices.findIndex(choice => choice.id === value))); setOpen(current => !current); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 36, padding: '7px 10px', background: surface, color: foreground, border: `1px solid ${open ? accent : border}`, borderRadius: 6, fontSize: '0.76rem', fontWeight: 550, textAlign: 'left', cursor: loading ? 'wait' : 'pointer', boxShadow: open ? `0 0 0 2px ${accent}33` : 'none' }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 }}>{loading ? 'Loading models…' : selected?.name || placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" style={{ flexShrink: 0, color: accent, transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          style={{ position: 'absolute', top: 'calc(100% + 5px)', [align]: 0, zIndex: 200, width: 'max(100%, min(380px, calc(100vw - 24px)))', maxHeight: 'min(320px, 45vh)', overflowY: 'auto', overscrollBehavior: 'contain', background: surface, color: foreground, border: `1px solid ${border}`, borderRadius: 6, padding: 4, boxShadow: light ? '0 12px 28px rgba(30,55,40,0.16)' : '0 14px 32px rgba(0,0,0,0.45)' }}
        >
          {choices.map((choice, index) => {
            const enabled = available(choice);
            const selectedOption = choice.id === value;
            return (
              <button
                id={`${listId}-${index}`}
                key={choice.id}
                type="button"
                role="option"
                aria-selected={selectedOption}
                aria-disabled={!enabled}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => { if (enabled) choose(choice.id); }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '8px 9px', border: 0, borderRadius: 4, background: active === index ? `${accent}20` : 'transparent', color: enabled ? foreground : muted, textAlign: 'left', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.65 }}
              >
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.4, fontSize: '0.76rem' }}>{choice.name}{!enabled && <span style={{ color: muted }}> ({requireVision ? 'no vision' : 'no tools'})</span>}</span>
                {selectedOption && <Check size={14} color={accent} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
