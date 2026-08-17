import { buildFolderSections, normalizeBookmarkTree } from '../../src/core/bookmarks'

const tree = normalizeBookmarkTree([
  {
    id: 'browser-root',
    title: '',
    children: [
      { id: 'root-late', title: 'Root late', url: 'https://late.example', index: 9 },
      {
        id: 'folder-b',
        title: 'Folder B',
        index: 4,
        children: [{ id: 'b-bookmark', title: 'B', url: 'https://b.example' }],
      },
      {
        id: 'folder-a',
        title: 'Folder A',
        index: 2,
        children: [
          { id: 'a-late', title: 'A late', url: 'https://a-late.example', index: 5 },
          {
            id: 'grandchild',
            title: 'Grandchild',
            index: 3,
            children: [
              {
                id: 'great-grandchild',
                title: 'Great grandchild',
                children: [],
              },
            ],
          },
          { id: 'a-early', title: 'A early', url: 'https://a-early.example', index: 1 },
        ],
      },
      { id: 'root-early', title: 'Root early', url: 'https://early.example', index: 0 },
      { id: 'root-separator', title: '', type: 'separator', index: 1 },
    ],
  },
])

describe('bookmark display sections', () => {
  it('keeps root content visible and preserves child index order', () => {
    expect(buildFolderSections(tree, 'browser-root', 'subtree', new Set())).toEqual([
      {
        folderId: 'browser-root',
        depth: 0,
        directBookmarkIds: ['root-early', 'root-late'],
        childFolderIds: ['folder-a', 'folder-b'],
        isExpanded: true,
      },
      {
        folderId: 'folder-a',
        depth: 1,
        directBookmarkIds: ['a-early', 'a-late'],
        childFolderIds: ['grandchild'],
        isExpanded: false,
      },
      {
        folderId: 'folder-b',
        depth: 1,
        directBookmarkIds: ['b-bookmark'],
        childFolderIds: [],
        isExpanded: false,
      },
    ])
  })

  it('only recurses below an expanded parent in stable depth-first order', () => {
    expect(
      buildFolderSections(tree, 'browser-root', 'subtree', new Set(['grandchild'])).map(
        ({ folderId }) => folderId,
      ),
    ).toEqual(['browser-root', 'folder-a', 'folder-b'])

    expect(
      buildFolderSections(tree, 'browser-root', 'subtree', new Set(['folder-a'])).map(
        ({ folderId, depth, isExpanded }) => ({ folderId, depth, isExpanded }),
      ),
    ).toEqual([
      { folderId: 'browser-root', depth: 0, isExpanded: true },
      { folderId: 'folder-a', depth: 1, isExpanded: true },
      { folderId: 'grandchild', depth: 2, isExpanded: false },
      { folderId: 'folder-b', depth: 1, isExpanded: false },
    ])
  })

  it('does not expose subfolders in direct scope', () => {
    expect(buildFolderSections(tree, 'folder-a', 'direct', new Set(['folder-a']))).toEqual([
      {
        folderId: 'folder-a',
        depth: 0,
        directBookmarkIds: ['a-early', 'a-late'],
        childFolderIds: [],
        isExpanded: true,
      },
    ])
  })

  it('ignores missing and cyclic children without duplicating sections', () => {
    const malformed = normalizeBookmarkTree([
      {
        id: 'root',
        title: '',
        children: [
          { id: 'late', title: 'Late', url: 'https://late.example', index: 5 },
          { id: 'child', title: 'Child', index: 2, children: [] },
          { id: 'early', title: 'Early', url: 'https://early.example', index: 1 },
        ],
      },
    ])
    const root = malformed.nodes.get('root')
    const child = malformed.nodes.get('child')
    if (!root || !child) throw new Error('Malformed test fixture failed to initialize.')
    malformed.nodes.set('root', {
      ...root,
      childIds: ['missing', 'late', 'child', 'early', 'child'],
    })
    malformed.nodes.set('child', { ...child, childIds: ['root', 'missing'] })

    expect(buildFolderSections(malformed, 'root', 'subtree', new Set(['child']))).toEqual([
      {
        folderId: 'root',
        depth: 0,
        directBookmarkIds: ['early', 'late'],
        childFolderIds: ['child'],
        isExpanded: true,
      },
      {
        folderId: 'child',
        depth: 1,
        directBookmarkIds: [],
        childFolderIds: [],
        isExpanded: true,
      },
    ])
  })

  it('returns no sections for missing or non-folder roots', () => {
    expect(buildFolderSections(tree, 'missing', 'subtree', new Set())).toEqual([])
    expect(buildFolderSections(tree, 'root-early', 'subtree', new Set())).toEqual([])
  })
})
