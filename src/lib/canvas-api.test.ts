import { describe, expect, it } from 'vitest'
import {
  CANVAS_ARTIFACT_DEFAULT_LIMIT,
  CANVAS_ARTIFACT_MAX_LIMIT,
  normalizeCanvasArtifactListParams,
} from './canvas-api'

describe('canvas artifact API params', () => {
  it('normalizes empty paging and search params', () => {
    const params = normalizeCanvasArtifactListParams(new URLSearchParams())

    expect(params.limit).toBe(CANVAS_ARTIFACT_DEFAULT_LIMIT)
    expect(params.cursor).toBeNull()
    expect(params.query).toBe('')
    expect(params.sessionId).toBeNull()
  })

  it('caps list size and trims filters', () => {
    const params = normalizeCanvasArtifactListParams(new URLSearchParams({
      sessionId: ' session-1 ',
      limit: '9999',
      cursor: ' cursor-1 ',
      q: ' report ',
      presentationType: ' code ',
      bundleId: ' bundle-1 ',
    }))

    expect(params.limit).toBe(CANVAS_ARTIFACT_MAX_LIMIT)
    expect(params.sessionId).toBe('session-1')
    expect(params.cursor).toBe('cursor-1')
    expect(params.query).toBe('report')
    expect(params.presentationType).toBe('code')
    expect(params.bundleId).toBe('bundle-1')
  })
})
