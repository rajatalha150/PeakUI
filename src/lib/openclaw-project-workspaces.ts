import path from 'path'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  ensureOpenClawWorkspaceAlias,
  getOpenClawWorkspaceContainerRoot,
  getOpenClawWorkspaceHostRoot,
} from './openclaw-workspace'

const execFileAsync = promisify(execFile)

const WORKSPACE_METADATA_FILENAME = '.openclaw-workspace.json'
const WORKSPACE_GITIGNORE_FILENAME = '.gitignore'
const DEFAULT_WORKSPACE_SLUG = 'default'
const WORKSPACE_SKILLS_DIRNAME = 'skills'
const DEFAULT_BOOT_FILENAME = 'BOOT.md'
const DEFAULT_TOOLS_FILENAME = 'TOOLS.md'

const DEFAULT_BOOT_CONTENT = `# BOOT.md

## Startup Checklist
- Confirm the current objective before making major changes.
- Prefer the selected workspace before broader host paths.
- Keep deliverables in clearly named files.
- Update task state when the objective or next step changes.

## Notes
- This file is loaded into WorkSpaces as workspace startup guidance.
- Keep it short, operational, and specific to this workspace.
`

const DEFAULT_TOOLS_CONTENT = `# TOOLS.md

## Local Conventions
- Put working files in this workspace unless the user explicitly chooses another root.
- Use descriptive filenames and keep generated outputs grouped together.
- Prefer filesystem and code tools for local work before using shell.

## Available Patterns
- Keep prompt templates in \`skills/\`.
- Keep reusable notes, checklists, and operating conventions here.
`

const DEFAULT_SKILLS_README = `# Skills Library

Store reusable workspace-specific prompt or skill templates in this folder.

Recommended format:
- One Markdown file per skill
- Start with a title and 1-2 sentence purpose
- Keep examples concrete and short

Example files:
- \`release-checklist.md\`
- \`bug-triage.md\`
- \`customer-report.md\`
`

const DEFAULT_GITIGNORE_CONTENT = `${WORKSPACE_METADATA_FILENAME}
`

interface OpenClawWorkspaceMetadata {
  id: string
  slug: string
  name: string
  description: string
  autoGitBackup: boolean
  createdAt: string
  updatedAt: string
  lastGitBackupAt?: string
  lastGitBackupCommit?: string
  lastGitBackupError?: string
}

export interface OpenClawWorkspaceRecord {
  id: string
  slug: string
  name: string
  description: string
  autoGitBackup: boolean
  createdAt: string
  updatedAt: string
  relativePath: string
  containerPath: string
  hostPath: string
  bootPath: string
  toolsPath: string
  skillsPath: string
  skillCount: number
  skillFiles: string[]
  lastGitBackupAt?: string
  lastGitBackupCommit?: string
  lastGitBackupError?: string
}

export interface OpenClawWorkspaceContext {
  workspace: OpenClawWorkspaceRecord
  bootInstructions: string
  toolsInstructions: string
  skillTemplates: Array<{
    fileName: string
    title: string
    summary: string
  }>
}

export interface CreateOpenClawWorkspaceInput {
  name: string
  description?: string
  autoGitBackup?: boolean
}

export interface UpdateOpenClawWorkspaceInput {
  name?: string
  description?: string
  autoGitBackup?: boolean
}

function slugifyWorkspaceName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'workspace'
}

function buildWorkspaceRelativePath(userId: string, slug: string): string {
  return path.posix.join('users', userId, 'workspaces', slug)
}

function buildWorkspaceContainerPath(userId: string, slug: string): string {
  return path.join(getOpenClawWorkspaceContainerRoot(), 'users', userId, 'workspaces', slug)
}

function buildWorkspaceHostPath(relativePath: string): string {
  return path.join(getOpenClawWorkspaceHostRoot(), relativePath)
}

function workspaceMetadataPath(containerPath: string): string {
  return path.join(containerPath, WORKSPACE_METADATA_FILENAME)
}

function workspaceBootPath(containerPath: string): string {
  return path.join(containerPath, DEFAULT_BOOT_FILENAME)
}

function workspaceToolsPath(containerPath: string): string {
  return path.join(containerPath, DEFAULT_TOOLS_FILENAME)
}

function workspaceSkillsPath(containerPath: string): string {
  return path.join(containerPath, WORKSPACE_SKILLS_DIRNAME)
}

async function ensureTextFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') throw error
    await fs.writeFile(filePath, content, 'utf8')
  }
}

async function ensureWorkspaceScaffold(containerPath: string): Promise<void> {
  await fs.mkdir(containerPath, { recursive: true })
  await fs.mkdir(workspaceSkillsPath(containerPath), { recursive: true })
  await Promise.all([
    ensureTextFile(workspaceBootPath(containerPath), DEFAULT_BOOT_CONTENT),
    ensureTextFile(workspaceToolsPath(containerPath), DEFAULT_TOOLS_CONTENT),
    ensureTextFile(path.join(workspaceSkillsPath(containerPath), 'README.md'), DEFAULT_SKILLS_README),
    ensureTextFile(path.join(containerPath, WORKSPACE_GITIGNORE_FILENAME), DEFAULT_GITIGNORE_CONTENT),
  ])
}

async function readWorkspaceMetadata(containerPath: string): Promise<OpenClawWorkspaceMetadata | null> {
  try {
    const raw = await fs.readFile(workspaceMetadataPath(containerPath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OpenClawWorkspaceMetadata>
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.slug !== 'string'
      || typeof parsed.name !== 'string'
      || typeof parsed.description !== 'string'
      || typeof parsed.autoGitBackup !== 'boolean'
      || typeof parsed.createdAt !== 'string'
      || typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }
    return {
      id: parsed.id,
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      autoGitBackup: parsed.autoGitBackup,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      ...(typeof parsed.lastGitBackupAt === 'string' ? { lastGitBackupAt: parsed.lastGitBackupAt } : {}),
      ...(typeof parsed.lastGitBackupCommit === 'string' ? { lastGitBackupCommit: parsed.lastGitBackupCommit } : {}),
      ...(typeof parsed.lastGitBackupError === 'string' ? { lastGitBackupError: parsed.lastGitBackupError } : {}),
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ENOENT') return null
    throw error
  }
}

async function writeWorkspaceMetadata(containerPath: string, metadata: OpenClawWorkspaceMetadata): Promise<void> {
  await fs.writeFile(
    workspaceMetadataPath(containerPath),
    JSON.stringify(metadata, null, 2),
    'utf8',
  )
}

async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ENOENT') return []
    throw error
  }
}

async function buildWorkspaceRecord(
  userId: string,
  containerPath: string,
  metadata: OpenClawWorkspaceMetadata,
): Promise<OpenClawWorkspaceRecord> {
  const relativePath = buildWorkspaceRelativePath(userId, metadata.slug)
  const skillsPath = workspaceSkillsPath(containerPath)
  const skillFiles = (await listMarkdownFiles(skillsPath)).filter(fileName => fileName !== 'README.md')

  return {
    id: metadata.id,
    slug: metadata.slug,
    name: metadata.name,
    description: metadata.description,
    autoGitBackup: metadata.autoGitBackup,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    relativePath,
    containerPath,
    hostPath: buildWorkspaceHostPath(relativePath),
    bootPath: path.join(containerPath, DEFAULT_BOOT_FILENAME),
    toolsPath: path.join(containerPath, DEFAULT_TOOLS_FILENAME),
    skillsPath,
    skillCount: skillFiles.length,
    skillFiles,
    ...(metadata.lastGitBackupAt ? { lastGitBackupAt: metadata.lastGitBackupAt } : {}),
    ...(metadata.lastGitBackupCommit ? { lastGitBackupCommit: metadata.lastGitBackupCommit } : {}),
    ...(metadata.lastGitBackupError ? { lastGitBackupError: metadata.lastGitBackupError } : {}),
  }
}

async function readWorkspaceText(filePath: string, maxChars = 6000): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const trimmed = raw.trim()
    if (!trimmed) return ''
    return trimmed.length > maxChars
      ? `${trimmed.slice(0, maxChars)}\n\n[Truncated to ${maxChars} characters]`
      : trimmed
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ENOENT') return ''
    throw error
  }
}

async function readSkillTemplatePreview(skillsPath: string, fileName: string) {
  const content = await readWorkspaceText(path.join(skillsPath, fileName), 2400)
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const titleLine = lines.find(line => line.startsWith('# '))
  return {
    fileName,
    title: titleLine ? titleLine.replace(/^#\s+/, '').trim() : fileName.replace(/\.md$/i, ''),
    summary: lines
      .filter(line => !line.startsWith('# '))
      .join(' ')
      .slice(0, 260),
  }
}

async function runGitInWorkspace(containerPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: containerPath,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'OpenClaw Workspace',
      GIT_AUTHOR_EMAIL: 'openclaw@local.invalid',
      GIT_COMMITTER_NAME: 'OpenClaw Workspace',
      GIT_COMMITTER_EMAIL: 'openclaw@local.invalid',
    },
  })
  return stdout.trim()
}

async function maybeSnapshotWorkspaceGitBackup(
  containerPath: string,
  metadata: OpenClawWorkspaceMetadata,
  reason: string,
): Promise<OpenClawWorkspaceMetadata> {
  if (!metadata.autoGitBackup) {
    return metadata
  }

  try {
    await fs.access(path.join(containerPath, '.git'))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') throw error
    await runGitInWorkspace(containerPath, ['init'])
  }

  try {
    const status = await runGitInWorkspace(containerPath, ['status', '--porcelain', '--untracked-files=all'])
    if (!status.trim()) {
      if (metadata.lastGitBackupError) {
        const cleared = { ...metadata, lastGitBackupError: undefined }
        await writeWorkspaceMetadata(containerPath, cleared)
        return cleared
      }
      return metadata
    }

    await runGitInWorkspace(containerPath, ['add', '-A'])
    await runGitInWorkspace(containerPath, ['commit', '--no-gpg-sign', '-m', reason])
    const commitHash = await runGitInWorkspace(containerPath, ['rev-parse', 'HEAD'])
    const nextMetadata: OpenClawWorkspaceMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
      lastGitBackupAt: new Date().toISOString(),
      lastGitBackupCommit: commitHash,
      lastGitBackupError: undefined,
    }
    await writeWorkspaceMetadata(containerPath, nextMetadata)
    return nextMetadata
  } catch (error) {
    const nextMetadata: OpenClawWorkspaceMetadata = {
      ...metadata,
      lastGitBackupError: error instanceof Error ? error.message : String(error),
    }
    await writeWorkspaceMetadata(containerPath, nextMetadata)
    return nextMetadata
  }
}

async function ensureWorkspaceContainerRoot(userId: string): Promise<string> {
  await ensureOpenClawWorkspaceAlias()
  const root = path.join(getOpenClawWorkspaceContainerRoot(), 'users', userId, 'workspaces')
  await fs.mkdir(root, { recursive: true })
  return root
}

async function loadWorkspaceByDirectoryName(userId: string, directoryName: string): Promise<OpenClawWorkspaceRecord | null> {
  const containerPath = buildWorkspaceContainerPath(userId, directoryName)
  const metadata = await readWorkspaceMetadata(containerPath)
  if (!metadata) return null
  await ensureWorkspaceScaffold(containerPath)
  return buildWorkspaceRecord(userId, containerPath, metadata)
}

async function loadWorkspaceByIdInternal(userId: string, workspaceId: string): Promise<{
  containerPath: string
  metadata: OpenClawWorkspaceMetadata
} | null> {
  const root = await ensureWorkspaceContainerRoot(userId)
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const containerPath = path.join(root, entry.name)
    const metadata = await readWorkspaceMetadata(containerPath)
    if (metadata?.id === workspaceId) {
      await ensureWorkspaceScaffold(containerPath)
      return { containerPath, metadata }
    }
  }
  return null
}

export async function listOpenClawWorkspaces(userId: string): Promise<OpenClawWorkspaceRecord[]> {
  const root = await ensureWorkspaceContainerRoot(userId)
  const entries = await fs.readdir(root, { withFileTypes: true })
  const workspaces = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => loadWorkspaceByDirectoryName(userId, entry.name))
  )

  return workspaces
    .filter((workspace): workspace is OpenClawWorkspaceRecord => Boolean(workspace))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function ensureDefaultOpenClawWorkspace(userId: string): Promise<OpenClawWorkspaceRecord> {
  const existing = await listOpenClawWorkspaces(userId)
  if (existing.length > 0) {
    return existing[0]
  }

  return createOpenClawWorkspace(userId, {
    name: 'Default Workspace',
    description: 'Primary WorkSpaces workspace',
    autoGitBackup: false,
  }, DEFAULT_WORKSPACE_SLUG)
}

async function nextAvailableSlug(userId: string, desiredSlug: string): Promise<string> {
  const root = await ensureWorkspaceContainerRoot(userId)
  const taken = new Set(
    (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name),
  )
  if (!taken.has(desiredSlug)) return desiredSlug

  for (let index = 2; index < 1000; index += 1) {
    const next = `${desiredSlug}-${index}`
    if (!taken.has(next)) return next
  }

  throw new Error('Could not allocate a unique workspace path')
}

export async function createOpenClawWorkspace(
  userId: string,
  input: CreateOpenClawWorkspaceInput,
  forcedSlug?: string,
): Promise<OpenClawWorkspaceRecord> {
  const name = input.name.trim()
  if (!name) {
    throw new Error('Workspace name is required')
  }

  const slugBase = forcedSlug || slugifyWorkspaceName(name)
  const slug = await nextAvailableSlug(userId, slugBase)
  const containerPath = buildWorkspaceContainerPath(userId, slug)
  const now = new Date().toISOString()
  const metadata: OpenClawWorkspaceMetadata = {
    id: `${slug}-${Math.random().toString(36).slice(2, 8)}`,
    slug,
    name,
    description: input.description?.trim() || '',
    autoGitBackup: input.autoGitBackup === true,
    createdAt: now,
    updatedAt: now,
  }

  await ensureWorkspaceScaffold(containerPath)
  await writeWorkspaceMetadata(containerPath, metadata)
  const finalizedMetadata = await maybeSnapshotWorkspaceGitBackup(
    containerPath,
    metadata,
    'chore: initialize workspace scaffold',
  )
  return buildWorkspaceRecord(userId, containerPath, finalizedMetadata)
}

export async function getOpenClawWorkspaceById(userId: string, workspaceId: string): Promise<OpenClawWorkspaceRecord | null> {
  const found = await loadWorkspaceByIdInternal(userId, workspaceId)
  if (!found) return null
  return buildWorkspaceRecord(userId, found.containerPath, found.metadata)
}

export async function updateOpenClawWorkspace(
  userId: string,
  workspaceId: string,
  input: UpdateOpenClawWorkspaceInput,
): Promise<OpenClawWorkspaceRecord> {
  const found = await loadWorkspaceByIdInternal(userId, workspaceId)
  if (!found) {
    throw new Error('Workspace not found')
  }

  const nextMetadata: OpenClawWorkspaceMetadata = {
    ...found.metadata,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : found.metadata.name,
    description: typeof input.description === 'string' ? input.description.trim() : found.metadata.description,
    autoGitBackup: typeof input.autoGitBackup === 'boolean' ? input.autoGitBackup : found.metadata.autoGitBackup,
    updatedAt: new Date().toISOString(),
  }

  await writeWorkspaceMetadata(found.containerPath, nextMetadata)
  const finalizedMetadata = await maybeSnapshotWorkspaceGitBackup(
    found.containerPath,
    nextMetadata,
    'chore: update workspace metadata',
  )
  return buildWorkspaceRecord(userId, found.containerPath, finalizedMetadata)
}

export async function getOpenClawWorkspaceContext(
  userId: string,
  workspaceId?: string,
): Promise<OpenClawWorkspaceContext> {
  const workspace = workspaceId
    ? await getOpenClawWorkspaceById(userId, workspaceId)
    : await ensureDefaultOpenClawWorkspace(userId)

  const resolvedWorkspace = workspace || await ensureDefaultOpenClawWorkspace(userId)
  const internal = await loadWorkspaceByIdInternal(userId, resolvedWorkspace.id)
  if (!internal) {
    throw new Error('Workspace not found')
  }

  const finalizedMetadata = await maybeSnapshotWorkspaceGitBackup(
    internal.containerPath,
    internal.metadata,
    'chore: automatic workspace snapshot',
  )
  const refreshedWorkspace = await buildWorkspaceRecord(userId, internal.containerPath, finalizedMetadata)
  const [bootInstructions, toolsInstructions, skillTemplates] = await Promise.all([
    readWorkspaceText(workspaceBootPath(internal.containerPath)),
    readWorkspaceText(workspaceToolsPath(internal.containerPath)),
    Promise.all(refreshedWorkspace.skillFiles.map(fileName => readSkillTemplatePreview(refreshedWorkspace.skillsPath, fileName))),
  ])

  return {
    workspace: refreshedWorkspace,
    bootInstructions,
    toolsInstructions,
    skillTemplates: skillTemplates.filter(template => template.summary || template.title),
  }
}
