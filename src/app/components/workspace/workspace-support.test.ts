import { describe, expect, it } from 'vitest'

import { matchesWorkspaceSessionCollection, PINNED_SESSION_COLLECTION_ID } from './workspace-support'

const unfiled = { pinned: false, folderId: null }
const foldered = { pinned: false, folderId: 'product' }
const pinnedUnfiled = { pinned: true, folderId: null }
const pinnedFoldered = { pinned: true, folderId: 'product' }

describe('WorkSpaces session collections', () => {
  it('keeps All limited to ordinary, unfoldered sessions', () => {
    expect(matchesWorkspaceSessionCollection(unfiled, null)).toBe(true)
    expect(matchesWorkspaceSessionCollection(foldered, null)).toBe(false)
    expect(matchesWorkspaceSessionCollection(pinnedUnfiled, null)).toBe(false)
    expect(matchesWorkspaceSessionCollection(pinnedFoldered, null)).toBe(false)
  })

  it('places every pinned session in the dedicated virtual collection', () => {
    expect(matchesWorkspaceSessionCollection(pinnedUnfiled, PINNED_SESSION_COLLECTION_ID)).toBe(true)
    expect(matchesWorkspaceSessionCollection(pinnedFoldered, PINNED_SESSION_COLLECTION_ID)).toBe(true)
    expect(matchesWorkspaceSessionCollection(unfiled, PINNED_SESSION_COLLECTION_ID)).toBe(false)
  })

  it('does not duplicate pinned sessions inside ordinary folders', () => {
    expect(matchesWorkspaceSessionCollection(foldered, 'product')).toBe(true)
    expect(matchesWorkspaceSessionCollection(pinnedFoldered, 'product')).toBe(false)
  })
})
