import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import { getUserSettings } from '@/lib/settings'
import { submitComfyUiTxt2Img, submitComfyUiTxt2ImgDiffusers, submitComfyUiTxt2ImgSplit, detectComfyUiModelKind, getComfyUiHistory, comfyUiViewUrl } from '@/lib/comfyui-client'
import { createImageCanvasArtifact } from '@/lib/image-gen-artifacts'
import { resolvePublicOrigin } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    prompt?: unknown
    negativePrompt?: unknown
    width?: unknown
    height?: unknown
    steps?: unknown
    seed?: unknown
    sessionId?: unknown
    messageId?: unknown
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

  try {
    const settings = await getUserSettings(auth.user.id)
    if (settings.imageGenProvider === 'none') {
      return NextResponse.json({ error: 'Image generation is not configured' }, { status: 400 })
    }
    if (!settings.imageGenModel) {
      return NextResponse.json({ error: 'No image model selected' }, { status: 400 })
    }

    const baseUrl = settings.imageGenBaseUrl
    const origin = resolvePublicOrigin(req)
    const modelKind = await detectComfyUiModelKind(baseUrl, settings.imageGenModel)
    const submitOptions = {
      model: settings.imageGenModel,
      prompt,
      negativePrompt: typeof body.negativePrompt === 'string' ? body.negativePrompt : undefined,
      width: typeof body.width === 'number' ? body.width : undefined,
      height: typeof body.height === 'number' ? body.height : undefined,
      steps: typeof body.steps === 'number' ? body.steps : undefined,
      seed: typeof body.seed === 'number' ? body.seed : undefined,
    }
    let submitted: Awaited<ReturnType<typeof submitComfyUiTxt2Img>>
    if (modelKind === 'diffusers') {
      submitted = await submitComfyUiTxt2ImgDiffusers(baseUrl, submitOptions)
    } else if (modelKind === 'split') {
      if (!settings.imageGenClipName || !settings.imageGenVaeName) {
        return NextResponse.json({ error: 'Split model requires a text encoder and VAE. Configure them in Settings → Image Generation.' }, { status: 400 })
      }
      submitted = await submitComfyUiTxt2ImgSplit(baseUrl, {
        ...submitOptions,
        clipName: settings.imageGenClipName,
        vaeName: settings.imageGenVaeName,
        clipType: settings.imageGenClipType || 'qwen_image',
      })
    } else {
      submitted = await submitComfyUiTxt2Img(baseUrl, submitOptions)
    }

    if (!submitted.online) {
      return NextResponse.json({ error: submitted.error || 'ComfyUI unreachable' }, { status: 502 })
    }
    if (!submitted.promptId) {
      return NextResponse.json({ error: submitted.error || 'Generation failed to start' }, { status: 502 })
    }

    // Poll for completion (bounded).
    const deadline = Date.now() + 240_000
    let history = await getComfyUiHistory(baseUrl, submitted.promptId)
    while (!history.done && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      history = await getComfyUiHistory(baseUrl, submitted.promptId)
    }

    if (!history.done) {
      return NextResponse.json({ error: 'Generation timed out', promptId: submitted.promptId }, { status: 504 })
    }

    // Fetch each image's bytes from ComfyUI and persist as a Canvas artifact so
    // the image renders inline in chat and is downloadable through PeakUI (the
    // raw ComfyUI /view URL is a loopback address the browser can't reach).
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null

    const images: Array<{ filename: string; url: string; downloadUrl: string }> = []
    for (const image of history.images ?? []) {
      const viewUrl = comfyUiViewUrl(baseUrl, image)
      let bytes: Buffer
      try {
        const res = await fetch(viewUrl, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(`ComfyUI /view returned ${res.status}`)
        bytes = Buffer.from(await res.arrayBuffer())
      } catch (error) {
        console.error('[image-gen/generate] failed to fetch image bytes:', error)
        continue
      }

      const mimeType = image.filename.toLowerCase().endsWith('.png') ? 'image/png'
        : image.filename.toLowerCase().endsWith('.jpg') || image.filename.toLowerCase().endsWith('.jpeg') ? 'image/jpeg'
        : image.filename.toLowerCase().endsWith('.webp') ? 'image/webp'
        : 'image/png'

      const artifact = await prisma.$transaction(tx => createImageCanvasArtifact({
        tx,
        userId: auth.user.id,
        sessionId,
        messageId,
        name: image.filename,
        imageBytes: bytes,
        mimeType,
        bundleName: 'Generated Image',
        bundleRole: 'generated-image',
      }))

      images.push({
        filename: image.filename,
        url: `${origin}/api/canvas/artifacts/${artifact.id}/download`,
        downloadUrl: `${origin}/api/canvas/artifacts/${artifact.id}/download`,
      })
    }

    if (images.length === 0) {
      return NextResponse.json({ error: 'Generation produced no downloadable images' }, { status: 502 })
    }

    return NextResponse.json({ promptId: submitted.promptId, images })
  } catch (error) {
    console.error('[image-gen/generate] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Image generation failed' },
      { status: 500 },
    )
  }
}
