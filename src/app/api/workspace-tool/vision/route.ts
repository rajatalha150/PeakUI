import { NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { analyzeWorkspaceImagesForUser, normalizeWorkspaceVisionImages } from '@/lib/workspace-vision-server'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request) {
  try {
    const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
      forbiddenMessage: 'WorkSpaces access is not granted for this account.',
      actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before using WorkSpaces vision.',
    })
    if ('response' in access) return access.response

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const images = normalizeWorkspaceVisionImages(body.images)
    if (!images.length) return NextResponse.json({ error: 'At least one image is required.' }, { status: 400 })
    const result = await analyzeWorkspaceImagesForUser({
      userId: access.userId,
      images,
      userText: typeof body.user_text === 'string' ? body.user_text : '',
      mainModelSupportsVision: body.main_model_supports_vision === true,
      apiKeyOverride: typeof body.api_key === 'string' ? body.api_key : '',
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('WorkSpaces vision analysis failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'WorkSpaces vision analysis failed.' }, { status: 500 })
  }
}
