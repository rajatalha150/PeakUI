"use client"

export interface RenderMetricEntry {
  name: string
  durationMs: number
  at: number
  detail?: Record<string, unknown>
}

declare global {
  interface Window {
    __peakuiRenderMetrics?: RenderMetricEntry[]
  }
}

const MAX_METRICS = 200

export function shouldCollectRenderMetrics(): boolean {
  if (typeof window === 'undefined') return false
  return process.env.NODE_ENV !== 'production' || window.localStorage.getItem('peakui:render-metrics') === 'on'
}

export function recordRenderMetric(name: string, durationMs: number, detail?: Record<string, unknown>) {
  if (!shouldCollectRenderMetrics()) return
  const target = window.__peakuiRenderMetrics ?? []
  target.push({
    name,
    durationMs,
    at: Date.now(),
    detail,
  })
  if (target.length > MAX_METRICS) {
    target.splice(0, target.length - MAX_METRICS)
  }
  window.__peakuiRenderMetrics = target
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[render-metric]', { name, durationMs, detail })
  }
}
