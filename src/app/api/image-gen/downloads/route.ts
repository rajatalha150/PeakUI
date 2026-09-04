import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import {
  listImageDownloads,
  queueImageDownload,
  startImageDownload,
  pauseImageDownload,
  deleteImageDownload,
} from '@/lib/image-download-manager'
import { getHfModelDetail, pickDiffusersFiles, pickSplitFiles, diffusersFolderName } from '@/lib/hf-client'
import { getUserSettings } from '@/lib/settings'

export const runtime = 'nodejs'

/**
 * Infer the CLIPLoader text-encoder type from the model id / family hints.
 * Defaults to 'qwen_image' for the modern ComfyUI-native families (Anima,
 * Z-Image, Qwen-Image).
 */
function inferClipType(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (/(qwen|anima|z-image)/i.test(lower)) return 'qwen_image'
  if (/flux/i.test(lower)) return 'flux'
  if (/sdxl/i.test(lower)) return 'sdxl'
  if (/sd3/i.test(lower)) return 'sd3'
  return 'qwen_image'
}

export async function GET() {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const downloads = await listImageDownloads(auth.user.id)
    return NextResponse.json({ downloads })
  } catch (error) {
    console.error('[image-gen/downloads] GET error:', error)
    return NextResponse.json({ error: 'Failed to list downloads' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    action?: unknown
    modelId?: unknown
    filename?: unknown
    targetFolder?: unknown
    id?: unknown
  }

  try {
    const action = body.action

    if (action === 'queue') {
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
      const targetFolder = typeof body.targetFolder === 'string' ? body.targetFolder.trim() : 'checkpoints'
      if (!modelId || !filename) {
        return NextResponse.json({ error: 'modelId and filename are required' }, { status: 400 })
      }
      const download = await queueImageDownload(auth.user.id, { modelId, filename, targetFolder })
      return NextResponse.json({ download })
    }

    if (action === 'queue-diffusers') {
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelId) {
        return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
      }
      const settings = await getUserSettings(auth.user.id)
      const detail = await getHfModelDetail(modelId, settings.hfToken || undefined)
      const files = pickDiffusersFiles(detail.siblings)
      if (files.length === 0) {
        return NextResponse.json({ error: 'No model files found in this repo' }, { status: 400 })
      }
      const destName = diffusersFolderName(modelId)
      const downloads = []
      for (const filename of files) {
        const download = await queueImageDownload(auth.user.id, {
          modelId,
          filename,
          targetFolder: 'diffusers',
          destName,
        })
        downloads.push(download)
      }
      return NextResponse.json({ downloads })
    }

    if (action === 'queue-split') {
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelId) {
        return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
      }
      const settings = await getUserSettings(auth.user.id)
      const detail = await getHfModelDetail(modelId, settings.hfToken || undefined)
      const files = pickSplitFiles(detail.siblings)
      if (files.length === 0) {
        return NextResponse.json({ error: 'No split model files found in this repo' }, { status: 400 })
      }
      const downloads = []
      for (const file of files) {
        const download = await queueImageDownload(auth.user.id, {
          modelId,
          filename: file.rfilename,
          targetFolder: file.targetFolder,
        })
        downloads.push(download)
      }

      // Auto-pair the split components: pick the UNet as the model and the
      // text encoder + VAE as its companions, so generation works without
      // manual configuration. The user can still change these in Settings.
      const unet = files.find(f => f.targetFolder === 'diffusion_models')
      const clip = files.find(f => f.targetFolder === 'text_encoders')
      const vae = files.find(f => f.targetFolder === 'vae')
      const unetName = unet ? unet.rfilename.split('/').pop()! : ''
      const clipName = clip ? clip.rfilename.split('/').pop()! : ''
      const vaeName = vae ? vae.rfilename.split('/').pop()! : ''
      const clipType = inferClipType(modelId)
      await prisma.userSettings.updateMany({
        where: { userId: auth.user.id },
        data: {
          imageGenModel: unetName,
          ...(clipName ? { imageGenClipName: clipName } : {}),
          ...(vaeName ? { imageGenVaeName: vaeName } : {}),
          ...(clipType ? { imageGenClipType: clipType } : {}),
        },
      })

      return NextResponse.json({ downloads, model: unetName, clipName, vaeName, clipType })
    }

    if (action === 'start') {
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const download = await startImageDownload(auth.user.id, id)
      return NextResponse.json({ download })
    }

    if (action === 'start-model') {
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelId) return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
      const downloads = await listImageDownloads(auth.user.id)
      const modelDownloads = downloads.filter(d => d.modelId === modelId && d.status !== 'done')
      for (const d of modelDownloads) {
        await startImageDownload(auth.user.id, d.id)
      }
      return NextResponse.json({ ok: true, started: modelDownloads.length })
    }

    if (action === 'pause') {
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      await pauseImageDownload(auth.user.id, id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'delete') {
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      await deleteImageDownload(auth.user.id, id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[image-gen/downloads] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download operation failed' },
      { status: 500 },
    )
  }
}
