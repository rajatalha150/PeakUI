"use client";

import React from 'react';

interface ReliabilityRecord {
  model: string;
  tool: string;
  success: number;
  failure: number;
  lastError: string;
  lastAt: string;
}

/**
 * Tool-reliability scoreboard (Phase 4). Fetches the per-model/per-tool
 * success/failure snapshot and renders the most-broken pairs first, with a
 * reset button. Live, in-memory data — no persistence.
 */
export default function ToolReliabilityPanel() {
  const [records, setRecords] = React.useState<ReliabilityRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/workspace-tool/reliability');
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load');
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reliability data');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = React.useCallback(async () => {
    try {
      await fetch('/api/workspace-tool/reliability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      setRecords([]);
    } catch {
      // Ignore reset failures.
    }
  }, []);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (loading) {
    return <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>Loading…</div>;
  }

  if (error) {
    return <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{error}</div>;
  }

  if (records.length === 0) {
    return (
      <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
        No tool activity recorded yet. Run a few WorkSpaces tasks and this panel will show which model/tool pairs are reliable.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{records.length} model/tool pair{records.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={() => void reset()}
          style={{
            fontSize: '0.78rem',
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
      {records.slice(0, 20).map(record => {
        const total = record.success + record.failure;
        const rate = total > 0 ? Math.round((record.failure / total) * 100) : 0;
        const color = rate >= 50 ? 'var(--danger, #ef4444)' : rate >= 20 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)';
        return (
          <div
            key={`${record.model}\u0000${record.tool}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '4px 12px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
              <strong>{record.tool}</strong> <span style={{ color: 'var(--text-secondary)' }}>· {record.model}</span>
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color }}>
              {record.success}✓ / {record.failure}✗ {rate > 0 ? `(${rate}% fail)` : ''}
            </div>
            {record.lastError ? (
              <div style={{ gridColumn: '1 / -1', fontSize: '0.76rem', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                Last error: {record.lastError}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
