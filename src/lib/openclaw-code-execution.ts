import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import type { OpenClawCodeExecutionMode } from './settings'
import { getOpenClawWorkspaceContainerRoot, getOpenClawWorkspaceHostRoot } from './openclaw-workspace'

export type OpenClawCodeRuntime = 'python' | 'node'

export interface OpenClawCodeExecutionRequest {
  runtime: OpenClawCodeRuntime
  code: string
  filename?: string
  workspacePath?: string
  args?: string[]
  sessionId: string
}

export interface OpenClawCodeExecutionSettings {
  openClawCodeExecutionMode: OpenClawCodeExecutionMode
}

export interface OpenClawCodeExecutionPreparation {
  runtime: OpenClawCodeRuntime
  code: string
  filename: string
  args: string[]
  sessionId: string
  relativeWorkspacePath: string
  hostWorkspacePath: string
  containerWorkspacePath: string
}

export interface OpenClawCodeExecutionResult {
  success: boolean
  runtime: OpenClawCodeRuntime
  command: string
  workingDirectory: string
  scriptPath: string
  stdout: string
  stderr: string
  exitCode: number | null
  duration: number
  files: Array<{
    path: string
    relativePath: string
    kind: 'file' | 'directory'
    size?: number
    modifiedAt?: string
  }>
  outputTruncated: boolean
}

const MAX_CODE_BYTES = 180_000
const MAX_ARGS = 20
const MAX_ARG_LENGTH = 500
const MAX_OUTPUT_BYTES = 180_000
const MAX_FILE_ENTRIES = 120
const EXECUTION_TIMEOUT_MS = 60_000
const NODE_MEMORY_MB = 128
const PYTHON_MEMORY_BYTES = 256 * 1024 * 1024
const PYTHON_FILE_SIZE_BYTES = 16 * 1024 * 1024

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'workspace'
}

function normalizeRelativeWorkspacePath(sessionId: string, workspacePath?: string): string {
  const basePath = workspacePath?.trim()
    ? path.posix.normalize(workspacePath.trim().replace(/^\/+/, ''))
    : path.posix.join('sessions', sanitizeSegment(sessionId))

  if (basePath === '' || basePath === '.' || basePath.startsWith('../') || basePath.includes('/../')) {
    throw new Error('workspacePath must stay inside the managed workspace root')
  }

  return basePath
}

function sanitizeFilename(runtime: OpenClawCodeRuntime, filename?: string): string {
  const extension = runtime === 'python' ? '.py' : '.mjs'
  if (!filename?.trim()) {
    return `main${extension}`
  }

  const baseName = path.basename(filename.trim())
  const cleaned = baseName.replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!cleaned) {
    return `main${extension}`
  }

  return cleaned.includes('.') ? cleaned : `${cleaned}${extension}`
}

export function prepareOpenClawCodeExecutionRequest(
  request: OpenClawCodeExecutionRequest,
  settings: OpenClawCodeExecutionSettings
): OpenClawCodeExecutionPreparation {
  if (settings.openClawCodeExecutionMode === 'deny') {
    throw new Error('Code execution sandbox is disabled')
  }

  if (request.runtime !== 'python' && request.runtime !== 'node') {
    throw new Error('Unsupported code runtime')
  }

  if (!request.sessionId.trim()) {
    throw new Error('A valid WorkSpaces session id is required')
  }

  if (!request.code.trim()) {
    throw new Error('Code is required')
  }

  if (Buffer.byteLength(request.code, 'utf8') > MAX_CODE_BYTES) {
    throw new Error(`Code payload exceeds the ${MAX_CODE_BYTES} byte limit`)
  }

  const args = (request.args || [])
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_ARGS)

  if (args.some(arg => arg.length > MAX_ARG_LENGTH)) {
    throw new Error(`Arguments must each stay under ${MAX_ARG_LENGTH} characters`)
  }

  const relativeWorkspacePath = normalizeRelativeWorkspacePath(request.sessionId, request.workspacePath)
  const filename = sanitizeFilename(request.runtime, request.filename)
  const hostWorkspacePath = path.join(getOpenClawWorkspaceHostRoot(), relativeWorkspacePath)
  const containerWorkspacePath = path.join(getOpenClawWorkspaceContainerRoot(), relativeWorkspacePath)

  return {
    runtime: request.runtime,
    code: request.code,
    filename,
    args,
    sessionId: request.sessionId,
    relativeWorkspacePath,
    hostWorkspacePath,
    containerWorkspacePath,
  }
}

export function buildOpenClawCodeApprovalPayload(request: OpenClawCodeExecutionPreparation) {
  return {
    runtime: request.runtime,
    code: request.code,
    filename: request.filename,
    workspacePath: request.relativeWorkspacePath,
    args: request.args,
    sessionId: request.sessionId,
  }
}

function buildPythonGuardScript(): string {
  return `
import os
import resource
import runpy
import sys

workspace = os.path.realpath(sys.argv[1])
script = os.path.realpath(sys.argv[2])
cpu_seconds = int(sys.argv[3])
memory_bytes = int(sys.argv[4])
max_file_bytes = int(sys.argv[5])
script_args = sys.argv[6:]
base_prefix = os.path.realpath(sys.base_prefix)
exec_prefix = os.path.realpath(sys.exec_prefix)
allowed_reads = {base_prefix, exec_prefix, '/usr', '/lib', '/bin', '/sbin', workspace}
allowed_writes = {workspace}

def limit_resources():
    soft, hard = resource.getrlimit(resource.RLIMIT_CPU)
    resource.setrlimit(resource.RLIMIT_CPU, (min(soft, cpu_seconds), hard))
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    resource.setrlimit(resource.RLIMIT_AS, (min(soft, memory_bytes), hard))
    soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
    resource.setrlimit(resource.RLIMIT_FSIZE, (min(soft, max_file_bytes), hard))

class SecurityError(Exception):
    pass

def check_path(path, allowed):
    real = os.path.realpath(path)
    for a in allowed:
        if real.startswith(a + os.sep) or real == a:
            return True
    return False

original_open = open
original_chdir = os.chdir
original_system = os.system

file_sizes = {}

def guarded_open(path, *args, **kwargs):
    path_str = str(path)
    if 'w' in args[1] if len(args) > 1 else 'w' in kwargs.get('mode', 'r'):
        if not check_path(path_str, allowed_writes):
            raise SecurityError(f'Write denied: {path_str}')
        file_sizes[path_str] = 0
    else:
        if not check_path(path_str, allowed_reads):
            raise SecurityError(f'Read denied: {path_str}')
    result = original_open(path, *args, **kwargs)
    return result

def guarded_chdir(path):
    if not check_path(path, allowed_writes):
        raise SecurityError(f'chdir denied: {path}')

def guarded_system(cmd):
    raise SecurityError('os.system() is disabled')

os.open = guarded_open
os.chdir = guarded_chdir
os.system = guarded_system

import builtins
original_file_sizes = {}
def tracked_open(path, *args, **kwargs):
    path_str = str(path)
    mode = args[1] if len(args) > 1 else kwargs.get('mode', 'r')
    if 'w' in mode or 'a' in mode:
        if not check_path(path_str, allowed_writes):
            raise SecurityError(f'Write denied: {path_str}')
        original_file_sizes[path_str] = 0
    else:
        if not check_path(path_str, allowed_reads):
            raise SecurityError(f'Read denied: {path_str}')
    f = original_open(path, *args, **kwargs)
    if path_str in original_file_sizes:
        original_file_sizes[path_str] = f
    return f

def tracked_read(self, n=-1):
    data = self._original_read(n)
    path_str = str(self.name)
    if path_str in original_file_sizes and self is original_file_sizes[path_str]:
        size = getattr(self, '_written_size', 0) + len(data)
        setattr(self, '_written_size', size)
        if size > max_file_bytes:
            raise SecurityError(f'File too large: {path_str}')
    return data

def tracked_write(self, data):
    path_str = str(self.name)
    if path_str in original_file_sizes and self is original_file_sizes[path_str]:
        size = getattr(self, '_written_size', 0) + len(data)
        setattr(self, '_written_size', size)
        if size > max_file_bytes:
            raise SecurityError(f'File too large: {path_str}')
    return self._original_write(data)

builtins.open = tracked_open
original_file_open = original_open

class GuardedFile:
    def __init__(self, file_obj):
        object.__setattr__(self, '_file', file_obj)
        if hasattr(file_obj, 'read'):
            object.__setattr__(self, '_original_read', file_obj.read)
            file_obj.read = lambda n=-1: tracked_read(self, n)
        if hasattr(file_obj, 'write'):
            object.__setattr__(self, '_original_write', file_obj.write)
            file_obj.write = lambda data: tracked_write(self, data)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, '_file'), name)

    def __setattr__(self, name, value):
        if name.startswith('_'):
            object.__setattr__(self, name, value)
        else:
            setattr(object.__getattribute__(self, '_file'), name, value)

    def __enter__(self):
        return GuardedFile(object.__getattribute__(self, '_file').__enter__())

    def __exit__(self, *args):
        return object.__getattribute__(self, '_file').__exit__(*args)

def guarded_open(path, *args, **kwargs):
    return GuardedFile(original_file_open(path, *args, **kwargs))

builtins.open = guarded_open

if __name__ == '__main__':
    limit_resources()
    sys.argv = [sys.argv[0], script] + script_args
    try:
        runpy.run_path(script, run_name='__main__')
    except SecurityError as e:
        print(f'SecurityError: {{e}}', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'Error: {{e}}', file=sys.stderr)
        sys.exit(1)
`
}

function buildNodeGuardScript(): string {
  return `
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('GuardError:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  if (err instanceof Error) {
    console.error('GuardError:', err.message);
  }
  process.exit(1);
});

// Override writeFile to prevent writing outside workspace
const originalWriteFile = fs.promises.writeFile;
fs.promises.writeFile = async (filePath, data, options) => {
  throw new Error('Direct file writes are not allowed in the sandbox. Use stdout for output.');
};

const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = (filePath, data, options) => {
  throw new Error('Direct file writes are not allowed in the sandbox. Use stdout for output.');
};
`
}

async function collectWorkspaceEntries(hostWorkspacePath: string): Promise<Array<{
  path: string
  relativePath: string
  kind: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}>> {
  const entries: Array<{
    path: string
    relativePath: string
    kind: 'file' | 'directory'
    size?: number
    modifiedAt?: string
  }> = []

  const walk = async (currentHostPath: string, relativePath?: string) => {
    const stats = await fs.stat(currentHostPath)
    entries.push({
      path: currentHostPath,
      relativePath: relativePath || path.basename(currentHostPath),
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.isFile() ? stats.size : undefined,
      modifiedAt: stats.mtime.toISOString(),
    })

    if (!stats.isDirectory()) return

    const children = await fs.readdir(currentHostPath)
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      if (entries.length >= MAX_FILE_ENTRIES) return
      const childHostPath = path.join(currentHostPath, child)
      const childRelativePath = relativePath ? path.posix.join(relativePath, child) : child
      await walk(childHostPath, childRelativePath)
    }
  }

  await walk(hostWorkspacePath)
  return entries
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  duration: number
  outputTruncated: boolean
}

async function runCommandWithCapturedOutput(
  command: string,
  args: string[],
  cwd: string,
  abortSignal?: AbortSignal
): Promise<CommandResult> {
  const startedAt = Date.now()
  const sandboxEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH ?? '',
  }

  return await new Promise((resolve, reject) => {
    // Check if already aborted
    if (abortSignal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const child = spawn(command, args, {
      cwd,
      env: sandboxEnv,
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let outputTruncated = false
    let finished = false

    function terminateChildProcess(): void {
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        // On Windows Node does not support POSIX signals well, so use the
        // default signal first; SIGKILL falls back where available.
        if (process.platform === 'win32') {
          child.kill()
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // Ignore if the process already exited.
      }
    }

    // Abort handler
    const abortHandler = () => {
      if (finished) return
      finished = true
      terminateChildProcess()
      resolve({
        stdout,
        stderr,
        exitCode: -1,
        duration: Date.now() - startedAt,
        outputTruncated,
      })
    }

    // Attach abort listener if provided
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler)
    }

    const finish = (result: CommandResult) => {
      if (finished) return
      finished = true
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler)
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      if (finished) return
      terminateChildProcess()
    }, EXECUTION_TIMEOUT_MS)

    const appendChunk = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      if (finished) return
      const remaining = MAX_OUTPUT_BYTES - outputBytes
      if (remaining <= 0) {
        outputTruncated = true
        terminateChildProcess()
        return
      }

      const slice = chunk.subarray(0, remaining)
      outputBytes += slice.length
      const text = slice.toString('utf8')
      if (target === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }

      if (slice.length < chunk.length) {
        outputTruncated = true
        terminateChildProcess()
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => appendChunk('stdout', Buffer.from(chunk)))
    child.stderr?.on('data', (chunk: Buffer) => appendChunk('stderr', Buffer.from(chunk)))
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler)
      }
      reject(error)
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      finish({
        stdout,
        stderr,
        exitCode: code,
        duration: Date.now() - startedAt,
        outputTruncated,
      })
    })
  })
}

export async function runOpenClawCodeExecution(
  request: OpenClawCodeExecutionRequest,
  settings: OpenClawCodeExecutionSettings,
  abortSignal?: AbortSignal
): Promise<OpenClawCodeExecutionResult> {
  const prepared = prepareOpenClawCodeExecutionRequest(request, settings)
  await fs.mkdir(prepared.containerWorkspacePath, { recursive: true })

  const scriptHostPath = path.join(prepared.hostWorkspacePath, prepared.filename)
  const scriptContainerPath = path.join(prepared.containerWorkspacePath, prepared.filename)
  await fs.writeFile(scriptContainerPath, prepared.code, 'utf8')

  let command = ''
  let args: string[] = []

  if (prepared.runtime === 'python') {
    const guardName = '__openclaw_guard__.py'
    const guardContainerPath = path.join(prepared.containerWorkspacePath, guardName)
    await fs.writeFile(guardContainerPath, `${buildPythonGuardScript()}\n`, 'utf8')
    command = 'python3'
    args = [
      '-I',
      '-S',
      guardContainerPath,
      prepared.containerWorkspacePath,
      scriptContainerPath,
      '10',
      String(PYTHON_MEMORY_BYTES),
      String(PYTHON_FILE_SIZE_BYTES),
      ...prepared.args,
    ]
  } else {
    const guardName = '__openclaw_guard__.cjs'
    const guardContainerPath = path.join(prepared.containerWorkspacePath, guardName)
    await fs.writeFile(guardContainerPath, `${buildNodeGuardScript()}\n`, 'utf8')
    command = 'node'
    args = [
      '--permission',
      `--allow-fs-read=${prepared.containerWorkspacePath}`,
      `--allow-fs-write=${prepared.containerWorkspacePath}`,
      `--max-old-space-size=${NODE_MEMORY_MB}`,
      '--require',
      guardContainerPath,
      scriptContainerPath,
      ...prepared.args,
    ]
  }

  const commandString = [command, ...args].join(' ')
  const execution = await runCommandWithCapturedOutput(command, args, prepared.containerWorkspacePath, abortSignal)
  const files = await collectWorkspaceEntries(prepared.hostWorkspacePath)

  return {
    success: execution.exitCode === 0,
    runtime: prepared.runtime,
    command: commandString,
    workingDirectory: prepared.hostWorkspacePath,
    scriptPath: scriptHostPath,
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
    duration: execution.duration,
    files,
    outputTruncated: execution.outputTruncated,
  }
}
