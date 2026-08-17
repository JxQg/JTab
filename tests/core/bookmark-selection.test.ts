import {
  isFolderCovered,
  normalizeBookmarkTree,
  normalizeDisplayedFolders,
  resolveDisplayedBookmarkIds,
} from '../../src/core/bookmarks'
import type { DisplayedFolder } from '../../src/core/types'

const tree = normalizeBookmarkTree([
  {
    id: 'root',
    title: '',
    children: [
      {
        id: 'parent',
        title: 'Parent',
        children: [
          { id: 'direct-bookmark', title: 'Direct', url: 'https://direct.example' },
          {
            id: 'child',
            title: 'Child',
            children: [{ id: 'nested-bookmark', title: 'Nested', url: 'https://nested.example' }],
          },
        ],
      },
      { id: 'other', title: 'Other', children: [] },
    ],
  },
])

describe('displayed folder selection', () => {
  it('removes invalid, root, bookmark, and duplicate selections while preserving order', () => {
    const selections: DisplayedFolder[] = [
      { folderId: 'missing', scope: 'subtree', order: 0 },
      { folderId: 'other', scope: 'direct', order: 4 },
      { folderId: 'parent', scope: 'direct', order: 2 },
      { folderId: 'parent', scope: 'subtree', order: 3 },
      { folderId: 'direct-bookmark', scope: 'subtree', order: 1 },
      { folderId: 'root', scope: 'subtree', order: 5 },
    ]

    expect(normalizeDisplayedFolders(tree, selections)).toEqual([
      { folderId: 'parent', scope: 'direct', order: 0 },
      { folderId: 'other', scope: 'direct', order: 1 },
    ])
  })

  it('lets a subtree parent cover descendants regardless of entry order', () => {
    const selections: DisplayedFolder[] = [
      { folderId: 'child', scope: 'direct', order: 0 },
      { folderId: 'parent', scope: 'subtree', order: 1 },
    ]

    expect(normalizeDisplayedFolders(tree, selections)).toEqual([
      { folderId: 'parent', scope: 'subtree', order: 0 },
    ])
    expect(isFolderCovered(tree, 'child', selections)).toBe(true)
  })

  it('does not let a direct parent cover a selected descendant', () => {
    const selections: DisplayedFolder[] = [
      { folderId: 'parent', scope: 'direct', order: 0 },
      { folderId: 'child', scope: 'subtree', order: 1 },
    ]

    expect(normalizeDisplayedFolders(tree, selections)).toHaveLength(2)
    expect(isFolderCovered(tree, 'child', selections)).toBe(false)
    expect([...resolveDisplayedBookmarkIds(tree, selections)]).toEqual([
      'direct-bookmark',
      'nested-bookmark',
    ])
  })

  it('resolves only direct bookmarks for direct scope', () => {
    expect([
      ...resolveDisplayedBookmarkIds(tree, [{ folderId: 'parent', scope: 'direct', order: 0 }]),
    ]).toEqual(['direct-bookmark'])
  })
})
