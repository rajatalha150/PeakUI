import path from 'path'

export function isWindowsHostPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value.replace(/\\/g, '/'))
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

function expandTilde(input: string): string {
  if (typeof window !== 'undefined') {
    // Cannot resolve ~ on the browser; leave as-is.
    return input
  }
  const os = require('os')
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

export function isKnownWorkspaceToolHostPath(value: string, prefixes: string[]): boolean {
  if (!value || typeof value !== 'string') return false
  let normalized = normalizeSlashes(expandTilde(value.trim()))
  if (isWindowsHostPath(normalized)) {
    normalized = normalized.replace(/:/g, '').toLowerCase()
  }
  return prefixes.some(prefix => {
    let p = normalizeSlashes(expandTilde(prefix.trim()))
    if (isWindowsHostPath(p)) {
      p = p.replace(/:/g, '').toLowerCase()
    }
    return normalized === p || normalized.startsWith(p + '/')
  })
}
