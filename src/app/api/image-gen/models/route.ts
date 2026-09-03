import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import { getUserSettings } from '@/lib/settings'
import {
  getComfyUiSystemStats,
  listComfyUiFolders,
  listComfyUiModels,
  listComfyUiDiffusersModels,
  IMAGE_GEN_MODEL_FOLDERS,
} from '@/lib/comfyui-client'

export const runtime = 'nodejs'

export async function GET() {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const settings = await getUserSettings(auth.user.id)
    if (settings.imageGenProvider === 'none') {
      return NextResponse.json({ online: false, error: 'Image generation is not configured' })
    }

    const baseUrl = settings.imageGenBaseUrl
    const [stats, folders] = await Promise.all([
      getComfyUiSystemStats(baseUrl),
      listComfyUiFolders(baseUrl),
    ])

    // List models across the selectable generation folders.
    const modelFolders = IMAGE_GEN_MODEL_FOLDERS.filter(f => folders.folders.includes(f))
    const folderResults = await Promise.all(modelFolders.map(folder => listComfyUiModels(baseUrl, folder)))
    const models = folderResults.flatMap(result =>
      result.models.map(model => ({ name: model.name, folder: result.folder })),
    )

    // Diffusers-format models live in the `diffusers` folder (subfolders, not
    // files), so they are listed separately via the DiffusersLoader node.
    const diffusersResult = await listComfyUiDiffusersModels(baseUrl)
    const diffusersModels = diffusersResult.models.map(model => ({ name: model.name, folder: 'diffusers' }))

    return NextResponse.json({ online: stats.online, stats, folders: folders.folders, models: [...models, ...diffusersModels] })
  } catch (error) {
    console.error('[image-gen/models] error:', error)
    return NextResponse.json(
      { online: false, error: error instanceof Error ? error.message : 'Failed to list image models' },
      { status: 502 },
    )
  }
}
