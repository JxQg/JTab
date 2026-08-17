import {
  countBookmarks,
  countDescendants,
  formatBookmarkPath,
  normalizeBookmarkTree,
  searchBookmarks,
  type BrowserBookmarkTreeNode,
} from '../../src/core/bookmarks'

describe('bookmark tree normalization', () => {
  it('keeps opaque string IDs and normalizes more than eight folder levels', () => {
    const deepest: BrowserBookmarkTreeNode = {
      id: 'bookmark-final',
      title: 'Deep documentation',
      url: 'https://docs.example.com/deep',
    }
    let child = deepest
    for (let depth = 8; depth >= 1; depth -= 1) {
      child = { id: `folder-${depth}`, title: `Level ${depth}`, children: [child] }
    }
    const raw: BrowserBookmarkTreeNode[] = [{ id: 'root________', title: '', children: [child] }]

    const tree = normalizeBookmarkTree(raw)
    const bookmark = tree.nodes.get('bookmark-final')

    expect(tree.rootIds).toEqual(['root________'])
    expect(bookmark?.depth).toBe(9)
    expect(bookmark?.pathIds).toEqual([
      'root________',
      'folder-1',
      'folder-2',
      'folder-3',
      'folder-4',
      'folder-5',
      'folder-6',
      'folder-7',
      'folder-8',
      'bookmark-final',
    ])
    expect(formatBookmarkPath(tree, 'bookmark-final')).toContain('Level 8')
    expect(countDescendants(tree, 'root________')).toBe(9)
    expect(countBookmarks(tree, 'root________')).toBe(1)
  })

  it('distinguishes duplicate names by ID and searchable folder path', () => {
    const tree = normalizeBookmarkTree([
      {
        id: 'root',
        title: '',
        children: [
          {
            id: 'work',
            title: 'Work',
            children: [{ id: 'work-docs', title: 'Docs', url: 'https://work.example/docs' }],
          },
          {
            id: 'personal',
            title: 'Personal',
            children: [
              { id: 'personal-docs', title: 'Docs', url: 'https://personal.example/docs' },
            ],
          },
        ],
      },
    ])

    expect(searchBookmarks(tree, 'Docs')).toHaveLength(2)
    expect(searchBookmarks(tree, 'personal docs').map((result) => result.node.id)).toEqual([
      'personal-docs',
    ])
  })

  it('preserves Firefox separators and models browser-owned and managed capabilities', () => {
    const tree = normalizeBookmarkTree([
      {
        id: 'firefox-root',
        title: '',
        children: [
          { id: 'separator-guid', title: '', type: 'separator' },
          {
            id: 'toolbar-guid',
            title: 'Bookmarks Toolbar',
            children: [{ id: 'toolbar-child', title: 'Example', url: 'https://example.com' }],
          },
          {
            id: 'managed-guid',
            title: 'Company',
            folderType: 'managed',
            children: [{ id: 'managed-child', title: 'Policy', url: 'https://policy.example' }],
          },
        ],
      },
    ])

    expect(tree.nodes.get('separator-guid')).toMatchObject({
      kind: 'separator',
      url: null,
      childIds: [],
    })
    expect(tree.nodes.get('firefox-root')).toMatchObject({
      restriction: 'root',
      selfModifiable: false,
      childrenWritable: false,
    })
    expect(tree.nodes.get('toolbar-guid')).toMatchObject({
      restriction: 'root',
      selfModifiable: false,
      childrenWritable: true,
    })
    expect(tree.nodes.get('toolbar-child')).toMatchObject({
      restriction: null,
      selfModifiable: true,
      childrenWritable: false,
    })
    expect(tree.nodes.get('managed-guid')).toMatchObject({
      restriction: 'managed',
      selfModifiable: false,
      childrenWritable: false,
    })
    expect(tree.nodes.get('managed-child')).toMatchObject({
      restriction: 'managed',
      selfModifiable: false,
      childrenWritable: false,
    })
  })

  it('counts each descendant once when an anomalous tree contains cycles', () => {
    const tree = normalizeBookmarkTree([
      {
        id: 'root',
        title: '',
        children: [
          {
            id: 'folder',
            title: 'Folder',
            children: [{ id: 'bookmark', title: 'Bookmark', url: 'https://example.com' }],
          },
        ],
      },
    ])
    const root = tree.nodes.get('root')
    const folder = tree.nodes.get('folder')
    if (!root || !folder) throw new Error('Cycle fixture failed to initialize.')
    tree.nodes.set('root', { ...root, childIds: ['folder', 'folder'] })
    tree.nodes.set('folder', { ...folder, childIds: ['bookmark', 'root'] })

    expect(countDescendants(tree, 'root')).toBe(2)
    expect(countBookmarks(tree, 'root')).toBe(1)
  })

  it('searches 5,000 bookmarks by title, hostname, and path within 100ms', () => {
    const children: BrowserBookmarkTreeNode[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `bookmark-${index}`,
      title: `Reference ${index}`,
      url: `https://site-${index}.example.com/page`,
      index,
    }))
    const tree = normalizeBookmarkTree([
      {
        id: 'root-string-id',
        title: '',
        children: [{ id: 'references', title: 'Engineering', children }],
      },
    ])

    searchBookmarks(tree, 'site-4999')
    const startedAt = performance.now()
    const results = searchBookmarks(tree, 'engineering site-4999')
    const elapsed = performance.now() - startedAt

    expect(results.map((result) => result.node.id)).toEqual(['bookmark-4999'])
    expect(elapsed).toBeLessThan(100)
  })
})
