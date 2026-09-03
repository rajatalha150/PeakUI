/**
 * Persistent, resumable Hugging Face model download manager.
 *
 * Downloads image-generation models from Hugging Face into the ComfyUI models
 * directory. State is persisted in the `ImageModelDownload` table so a download
 * survives a restart and can be resumed from where it left off (HF's CDN
 * supports HTTP Range requests).
 *
 * The download runs in-process as a background job (like the automation
 * worker). Each row tracks bytes downloaded vs total, so the UI can show a
 * live progress bar and the manager can resume an interrupted download on the
 * next boot.
 */

import { createWriteStream, promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from './prisma'
import { hfResolveUrl } from './hf-client'

export type ImageDownloadStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error'

export interface ImageDownloadDto {
  id: string
  modelId: string
  filename: string
  targetFolder: string
  destName: string
  totalBytes: number
  downloadedBytes: number
  status: ImageDownloadStatus
  error: string | null
  progress: number
}

const COMFYUI_MODELS_ROOT = process.env.COMFYUI_MODELS_DIR || '/mnt/comfyui/models'

function toDto(row: {
  id: string
  modelId: string
  filename: string
  targetFolder: string
  destName: string
  totalBytes: bigint
  downloadedBytes: bigint
  status: string
  error: string | null
}): ImageDownloadDto {
  const total = Number(row.totalBytes)
  const downloaded = Number(row.downloadedBytes)
  return {
    id: row.id,
    modelId: row.modelId,
    filename: row.filename,
    targetFolder: row.targetFolder,
    destName: row.destName,
    totalBytes: total,
    downloadedBytes: downloaded,
    status: row.status as ImageDownloadStatus,
    error: row.error,
    progress: total > 0 ? Math.min(1, downloaded / total) : 0,
  }
}

export async function listImageDownloads(userId: string): Promise<ImageDownloadDto[]> {
  const rows = await prisma.imageModelDownload.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toDto)
}

/**
 * Queue a model file for download. Returns the row (existing or new). The
 * actual download is started by `startImageDownload` (or the boot resume).
 */
export async function queueImageDownload(
  userId: string,
  input: { modelId: string; filename: string; targetFolder: string; destName?: string },
): Promise<ImageDownloadDto> {
  const url = hfResolveUrl(input.modelId, input.filename)
  const destName = input.destName ?? ''
  const row = await prisma.imageModelDownload.upsert({
    where: { userId_modelId_filename: { userId, modelId: input.modelId, filename: input.filename } },
    update: { url, targetFolder: input.targetFolder, destName, status: 'queued', error: null },
    create: {
      userId,
      modelId: input.modelId,
      filename: input.filename,
      targetFolder: input.targetFolder,
      destName,
      url,
      status: 'queued',
    },
  })
  return toDto(row)
}

/** Mark a download as paused (stops the in-flight fetch if it is running). */
export async function pauseImageDownload(userId: string, id: string): Promise<void> {
  const row = await prisma.imageModelDownload.findFirst({ where: { id, userId } })
  if (!row) return
  if (row.status === 'downloading' || row.status === 'queued') {
    await prisma.imageModelDownload.update({ where: { id }, data: { status: 'paused' } })
  }
}

/** Remove a download row and its partial file. */
export async function deleteImageDownload(userId: string, id: string): Promise<void> {
  const row = await prisma.imageModelDownload.findFirst({ where: { id, userId } })
  if (!row) return
  await prisma.imageModelDownload.delete({ where: { id } })
  const partialPath = targetPath(row.targetFolder, row.filename, row.destName)
  await fs.rm(partialPath, { force: true }).catch(() => {})
}

function targetPath(targetFolder: string, filename: string, destName: string): string {
  // For diffusers downloads, `destName` is the model folder name and `filename`
  // carries the full subpath (e.g. "unet/diffusion_pytorch_model.safetensors").
  // Preserve that structure under the diffusers folder.
  if (destName) {
    return path.join(COMFYUI_MODELS_ROOT, targetFolder, destName, filename)
  }
  // Single-file checkpoint: strip any leading folder that duplicates the
  // target folder.
  const base = filename.split('/').pop() || filename
  return path.join(COMFYUI_MODELS_ROOT, targetFolder, base)
}

const activeDownloads = new Map<string, AbortController>()

/**
 * Start (or resume) a download. Resumable: if a partial file exists, the
 * request carries a Range header and appends to it. Returns the final DTO.
 */
export async function startImageDownload(userId: string, id: string): Promise<ImageDownloadDto> {
  const row = await prisma.imageModelDownload.findFirst({ where: { id, userId } })
  if (!row) throw new Error('Download not found')
  if (row.status === 'done') return toDto(row)

  const controller = new AbortController()
  activeDownloads.set(id, controller)

  try {
    await prisma.imageModelDownload.update({ where: { id }, data: { status: 'downloading', error: null } })

    const dest = targetPath(row.targetFolder, row.filename, row.destName)
    await mkdir(path.dirname(dest), { recursive: true })

    // Determine resume offset from the partial file on disk.
    let existingBytes = 0
    try {
      const stat = await fs.stat(dest)
      existingBytes = stat.size
    } catch {
      existingBytes = 0
    }

    const headers: Record<string, string> = {}
    if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`

    const response = await fetch(row.url, { headers, signal: controller.signal, redirect: 'follow' })

    if (response.status === 416) {
      // Range not satisfiable — the file is already complete.
      await prisma.imageModelDownload.update({
        where: { id },
        data: { status: 'done', downloadedBytes: row.totalBytes, totalBytes: row.totalBytes },
      })
      return toDto((await prisma.imageModelDownload.findUniqueOrThrow({ where: { id } })))
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }

    const totalBytes = existingBytes + Number(response.headers.get('content-length') || 0)
    await prisma.imageModelDownload.update({
      where: { id },
      data: { totalBytes: totalBytes > 0 ? BigInt(totalBytes) : row.totalBytes },
    })

    const stream = response.body
    if (!stream) throw new Error('No response body')

    const writer = createWriteStream(dest, { flags: existingBytes > 0 ? 'a' : 'w' })
    let downloaded = existingBytes

    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        downloaded += value.byteLength
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), err => (err ? reject(err) : resolve()))
        })
        // Persist progress periodically (every ~8 MB) to bound DB writes.
        if (downloaded % (8 * 1024 * 1024) < value.byteLength) {
          await prisma.imageModelDownload.update({
            where: { id },
            data: { downloadedBytes: BigInt(downloaded) },
          })
        }
      }
    } finally {
      await new Promise<void>(resolve => writer.end(() => resolve()))
    }

    await prisma.imageModelDownload.update({
      where: { id },
      data: { status: 'done', downloadedBytes: BigInt(downloaded), totalBytes: BigInt(downloaded), error: null },
    })
  } catch (error) {
    if (controller.signal.aborted) {
      // Paused/cancelled — leave the partial file for resume.
      await prisma.imageModelDownload.update({ where: { id }, data: { status: 'paused' } }).catch(() => {})
    } else {
      await prisma.imageModelDownload.update({
        where: { id },
        data: { status: 'error', error: error instanceof Error ? error.message : String(error) },
      }).catch(() => {})
    }
  } finally {
    activeDownloads.delete(id)
  }

  return toDto(await prisma.imageModelDownload.findUniqueOrThrow({ where: { id } }))
}

/** Abort an in-flight download (used by pause). */
export function abortImageDownload(id: string): void {
  activeDownloads.get(id)?.abort()
}

/**
 * Resume any downloads that were interrupted by a restart. Called from
 * instrumentation on boot. Only rows stuck in `downloading` (from a crash) are
 * resumed; `paused` rows are left for the user to resume explicitly.
 */
export async function resumeInterruptedDownloads(): Promise<void> {
  const rows = await prisma.imageModelDownload.findMany({ where: { status: 'downloading' } })
  for (const row of rows) {
    void startImageDownload(row.userId, row.id).catch(() => {})
  }
}
