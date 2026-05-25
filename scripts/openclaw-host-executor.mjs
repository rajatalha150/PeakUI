#!/usr/bin/env node

import http from 'http'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

const bindHost = process.env.OPENCLAW_HOST_EXECUTOR_BIND || '127.0.0.1'
const port = Number(process.env.OPENCLAW_HOST_EXECUTOR_PORT || '4318')
const sharedToken = process.env.OPENCLAW_HOST_EXECUTOR_TOKEN || ''
const shellPath = process.env.OPENCLAW_HOST_EXECUTOR_SHELL || process.env.SHELL || '/bin/bash'
const requestBodyLimitBytes = 1024 * 1024
const defaultEnv = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  USER: process.env.USER || '',
  SHELL: process.env.SHELL || shellPath,
  LANG: process.env.LANG || 'C.UTF-8',
  TERM: process.env.TERM || 'xterm-256color',
}

if (!sharedToken) {
  console.error('OPENCLAW_HOST_EXECUTOR_TOKEN is required.')
  process.exit(1)
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0

    request.on('data', chunk => {
      totalBytes += chunk.length
      if (totalBytes > requestBodyLimitBytes) {
        reject(new Error('Request body exceeds limit.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}

function hasValidAuth(request) {
  const header = request.headers.authorization || ''
  return header === `Bearer ${sharedToken}`
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function normalizeAbsolutePath(input) {
  return path.resolve(String(input || '').trim())
}

async function normalizeExistingRoots(value) {
  if (!Array.isArray(value)) return []
  const candidates = value
    .filter(entry => typeof entry === 'string' && entry.trim())
    .map(entry => normalizeAbsolutePath(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)

  const roots = []
  for (const candidate of candidates) {
    try {
      const realPath = await fs.realpath(candidate)
      if (!roots.includes(realPath)) roots.push(realPath)
    } catch {
      // Ignore missing roots here; the caller returns a clear error if none are usable.
    }
  }

  return roots
}

function pathIsInsideRoot(candidate, roots) {
  const resolvedCandidate = normalizeAbsolutePath(candidate)
  return roots.some(root => {
    const relative = path.relative(root, resolvedCandidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

function normalizeEnvNames(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(entry => typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
}

function buildChildEnv(allowedEnvNames) {
  const env = { ...defaultEnv }
  for (const name of allowedEnvNames) {
    if (typeof process.env[name] === 'string') {
      env[name] = process.env[name]
    }
  }
  return env
}

function executeCommand({
  command,
  cwd,
  timeoutMs,
  maxOutputBytes,
  allowedEnvNames,
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const child = spawn(shellPath, ['-lc', command], {
      cwd,
      env: buildChildEnv(allowedEnvNames),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let timedOut = false
    let outputCapped = false
    let settled = false

    const finalize = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)

      if (timedOut) {
        stderr = `${stderr}${stderr ? '\n' : ''}Command timed out after ${timeoutMs}ms.`
      }

      if (outputCapped) {
        stderr = `${stderr}${stderr ? '\n' : ''}Command output exceeded ${maxOutputBytes} bytes and was terminated.`
      }

      resolve({
        success: code === 0 && !timedOut && !outputCapped,
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : null,
        duration: Date.now() - startedAt,
        command,
        target: 'host',
        signal: signal || null,
      })
    }

    const enforceOutputCap = () => {
      if (outputBytes <= maxOutputBytes || outputCapped) return
      outputCapped = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL')
        }
      }, 1500)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      outputBytes += Buffer.byteLength(chunk)
      stdout += chunk
      enforceOutputCap()
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      outputBytes += Buffer.byteLength(chunk)
      stderr += chunk
      enforceOutputCap()
    })

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL')
        }
      }, 1500)
    }, timeoutMs)

    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      resolve({
        success: false,
        stdout,
        stderr: error.message || 'Failed to spawn host shell command.',
        exitCode: null,
        duration: Date.now() - startedAt,
        command,
        target: 'host',
      })
    })

    child.on('close', (code, signal) => {
      finalize(code, signal)
    })
  })
}

const server = http.createServer(async (request, response) => {
  if (!hasValidAuth(request)) {
    sendJson(response, 401, { error: 'Unauthorized' })
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      shellPath,
      host: bindHost,
      port,
    })
    return
  }

  if (request.method !== 'POST' || request.url !== '/execute') {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  try {
    const body = await readJsonBody(request)
    const command = typeof body.command === 'string' ? body.command.trim() : ''
    const allowedRoots = await normalizeExistingRoots(body.allowedRoots)
    const allowedEnvNames = normalizeEnvNames(body.allowedEnvNames)
    const timeoutMs = clampNumber(body.timeoutMs, 1000, 300000, 60000)
    const maxOutputBytes = clampNumber(body.maxOutputBytes, 16384, 1048576, 262144)

    if (!command) {
      sendJson(response, 400, { error: 'Command is required.' })
      return
    }

    if (allowedRoots.length === 0) {
      sendJson(response, 400, { error: 'At least one existing allowed root is required for host shell execution.' })
      return
    }

    const requestedCwd = typeof body.cwd === 'string' && body.cwd.trim()
      ? normalizeAbsolutePath(body.cwd)
      : allowedRoots[0]

    let cwd
    try {
      cwd = await fs.realpath(requestedCwd)
    } catch {
      sendJson(response, 403, { error: `Working directory does not exist or is not accessible: ${requestedCwd}` })
      return
    }

    if (!pathIsInsideRoot(cwd, allowedRoots)) {
      sendJson(response, 403, { error: `Working directory is outside the approved roots: ${cwd}` })
      return
    }

    const result = await executeCommand({
      command,
      cwd,
      timeoutMs,
      maxOutputBytes,
      allowedEnvNames,
    })

    sendJson(response, 200, result)
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Host executor failed.',
    })
  }
})

server.listen(port, bindHost, () => {
  console.log(`Open Claw host executor listening on http://${bindHost}:${port}`)
})
