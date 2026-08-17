import {
  BookmarkRepositoryError,
  BrowserBookmarkRepository,
  type BookmarksApiPort,
  type BrowserBookmarkTreeNode,
} from '../../src/core/bookmarks'

type Listener<TArgs extends unknown[]> = (...args: TArgs) => void

class FakeEvent<TArgs extends unknown[]> {
  private readonly listeners = new Set<Listener<TArgs>>()

  addListener(listener: Listener<TArgs>): void {
    this.listeners.add(listener)
  }

  removeListener(listener: Listener<TArgs>): void {
    this.listeners.delete(listener)
  }

  emit(...args: TArgs): void {
    for (const listener of this.listeners) listener(...args)
  }
}

function baseTree(): BrowserBookmarkTreeNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'toolbar',
          title: 'Toolbar',
          children: [
            { id: 'bookmark', title: 'Example', url: 'https://example.com' },
            {
              id: 'folder',
              title: 'Folder',
              children: [{ id: 'child-folder', title: 'Child', children: [] }],
            },
          ],
        },
        { id: 'other', title: 'Other', children: [] },
        {
          id: 'managed',
          title: 'Managed',
          unmodifiable: 'managed',
          children: [],
        },
      ],
    },
  ]
}

function findRaw(
  roots: readonly BrowserBookmarkTreeNode[],
  id: string,
): BrowserBookmarkTreeNode | undefined {
  const stack = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.id === id) return node
    stack.push(...(node.children ?? []))
  }
  return undefined
}

class FakeBookmarksApi implements BookmarksApiPort {
  tree = baseTree()
  getTreeCalls = 0
  mutationCalls = 0
  updateImplementation:
    | ((id: string, changes: { title?: string; url?: string }) => Promise<BrowserBookmarkTreeNode>)
    | null = null

  readonly onChanged = new FakeEvent<[id: string, changeInfo: { title?: string; url?: string }]>()
  readonly onChildrenReordered = new FakeEvent<[id: string, reorderInfo: { childIds: string[] }]>()
  readonly onCreated = new FakeEvent<[id: string, bookmark: BrowserBookmarkTreeNode]>()
  readonly onImportBegan = new FakeEvent<[]>()
  readonly onImportEnded = new FakeEvent<[]>()
  readonly onMoved = new FakeEvent<
    [
      id: string,
      moveInfo: {
        parentId: string
        index: number
        oldParentId: string
        oldIndex: number
      },
    ]
  >()
  readonly onRemoved = new FakeEvent<
    [id: string, removeInfo: { parentId: string; index: number; node: BrowserBookmarkTreeNode }]
  >()

  async getTree(): Promise<BrowserBookmarkTreeNode[]> {
    this.getTreeCalls += 1
    return structuredClone(this.tree)
  }

  async create(details: {
    parentId: string
    title: string
    url?: string
    index?: number
  }): Promise<BrowserBookmarkTreeNode> {
    this.mutationCalls += 1
    return {
      id: 'created',
      parentId: details.parentId,
      title: details.title,
      ...(details.url === undefined ? {} : { url: details.url }),
      ...(details.index === undefined ? {} : { index: details.index }),
    }
  }

  async update(
    id: string,
    changes: { title?: string; url?: string },
  ): Promise<BrowserBookmarkTreeNode> {
    this.mutationCalls += 1
    if (this.updateImplementation) return this.updateImplementation(id, changes)
    const node = findRaw(this.tree, id)
    if (!node) throw new Error(`Missing fake node: ${id}`)
    if (changes.title !== undefined) node.title = changes.title
    if (changes.url !== undefined) node.url = changes.url
    return structuredClone(node)
  }

  async move(
    id: string,
    destination: { parentId: string; index?: number },
  ): Promise<BrowserBookmarkTreeNode> {
    this.mutationCalls += 1
    const node = findRaw(this.tree, id)
    if (!node) throw new Error(`Missing fake node: ${id}`)
    return {
      ...structuredClone(node),
      parentId: destination.parentId,
      index: destination.index ?? 0,
    }
  }

  async remove(id: string): Promise<void> {
    void id
    this.mutationCalls += 1
  }

  async removeTree(id: string): Promise<void> {
    void id
    this.mutationCalls += 1
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof BookmarkRepositoryError ? error.code : undefined
}

describe('BrowserBookmarkRepository', () => {
  it('applies create, update, move, and remove operations to its normalized cache', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)

    const created = await repository.create({
      parentId: 'toolbar',
      title: 'Created',
      url: '  https://created.example/path  ',
      index: 1,
    })
    expect(created).toMatchObject({
      id: 'created',
      parentId: 'toolbar',
      index: 1,
      url: 'https://created.example/path',
    })
    expect(created.pathIds).toEqual(['root', 'toolbar', 'created'])

    await repository.update('bookmark', { title: 'Updated' })
    expect((await repository.getTree()).nodes.get('bookmark')?.title).toBe('Updated')

    await repository.move('bookmark', { parentId: 'other', index: 0 })
    expect((await repository.getTree()).nodes.get('bookmark')).toMatchObject({
      parentId: 'other',
      index: 0,
      pathIds: ['root', 'other', 'bookmark'],
    })

    await repository.remove('bookmark', false)
    expect((await repository.getTree()).nodes.has('bookmark')).toBe(false)
  })

  it('rejects unsafe URLs before calling the browser API', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)

    await expect(
      repository.create({ parentId: 'toolbar', title: 'Unsafe', url: 'javascript:alert(1)' }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === 'invalid_url')
    expect(api.mutationCalls).toBe(0)
  })

  it('protects browser-owned nodes while allowing writes into their child collection', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)

    await expect(repository.update('root', { title: 'No' })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === 'root_read_only',
    )
    await expect(repository.update('toolbar', { title: 'No' })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === 'root_read_only',
    )
    await expect(repository.remove('managed', true)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === 'managed_read_only',
    )
    await expect(repository.move('folder', { parentId: 'child-folder' })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === 'descendant_move',
    )
    expect(api.mutationCalls).toBe(0)
    await expect(repository.getCapabilities('toolbar')).resolves.toMatchObject({
      canRename: false,
      canMove: false,
      canRemove: false,
      canAcceptChildren: true,
      reason: 'root',
    })
    await expect(repository.getCapabilities('managed')).resolves.toMatchObject({
      canMove: false,
      canAcceptChildren: false,
      reason: 'managed',
    })
    await expect(
      repository.create({
        parentId: 'toolbar',
        title: 'Allowed child',
        url: 'https://allowed.example',
      }),
    ).resolves.toMatchObject({ parentId: 'toolbar', selfModifiable: true })
    expect(api.mutationCalls).toBe(1)
  })

  it('serializes writes and continues after a rejected mutation', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)
    await repository.getTree()
    let active = 0
    let maximumActive = 0
    let releaseFirst: (() => void) | undefined
    let call = 0
    api.updateImplementation = async (id, changes) => {
      call += 1
      active += 1
      maximumActive = Math.max(maximumActive, active)
      if (call === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        active -= 1
        throw new Error('simulated write failure')
      }
      const node = findRaw(api.tree, id)
      if (!node) throw new Error('missing test bookmark')
      node.title = changes.title ?? node.title
      active -= 1
      return structuredClone(node)
    }

    const first = repository.update('bookmark', { title: 'First' })
    const second = repository.update('bookmark', { title: 'Second' })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
    expect(call).toBe(1)
    releaseFirst?.()

    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'fulfilled'])
    expect(maximumActive).toBe(1)
    expect((await repository.getTree()).nodes.get('bookmark')?.title).toBe('Second')
  })

  it('merges incremental event notifications into one microtask', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)
    await repository.getTree()
    const onChange = vi.fn()
    const unsubscribe = repository.subscribe(onChange)

    api.onChanged.emit('bookmark', { title: 'Changed once' })
    api.onChanged.emit('bookmark', { title: 'Changed twice' })
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect((await repository.getTree()).nodes.get('bookmark')?.title).toBe('Changed twice')
    unsubscribe()
  })

  it('subscribes when Firefox omits Chromium-only bookmark events', async () => {
    const api = new FakeBookmarksApi()
    Object.defineProperties(api, {
      onChildrenReordered: { value: undefined },
      onImportBegan: { value: undefined },
      onImportEnded: { value: undefined },
    })
    const repository = new BrowserBookmarkRepository(api)
    await repository.getTree()
    const onChange = vi.fn()

    const unsubscribe = repository.subscribe(onChange)
    api.onChanged.emit('bookmark', { title: 'Changed in Firefox' })
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect((await repository.getTree()).nodes.get('bookmark')?.title).toBe('Changed in Firefox')
    expect(() => unsubscribe()).not.toThrow()
  })

  it('applies create, move, reorder, and remove events without reloading the tree', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)
    await repository.getTree()
    const unsubscribe = repository.subscribe(vi.fn())
    const external: BrowserBookmarkTreeNode = {
      id: 'external',
      parentId: 'toolbar',
      index: 1,
      title: 'External',
      url: 'https://external.example',
    }

    api.onCreated.emit(external.id, external)
    api.onMoved.emit(external.id, {
      parentId: 'other',
      index: 0,
      oldParentId: 'toolbar',
      oldIndex: 1,
    })
    api.onChildrenReordered.emit('toolbar', { childIds: ['folder', 'bookmark'] })

    let tree = await repository.getTree()
    expect(tree.nodes.get('external')?.pathIds).toEqual(['root', 'other', 'external'])
    expect(tree.nodes.get('folder')?.index).toBe(0)
    expect(tree.nodes.get('bookmark')?.index).toBe(1)

    api.onRemoved.emit(external.id, { parentId: 'other', index: 0, node: external })
    tree = await repository.getTree()
    expect(tree.nodes.has('external')).toBe(false)
    expect(api.getTreeCalls).toBe(1)
    unsubscribe()
  })

  it('reloads the full tree once when a bookmark import ends', async () => {
    const api = new FakeBookmarksApi()
    const repository = new BrowserBookmarkRepository(api)
    await repository.getTree()
    const unsubscribe = repository.subscribe(vi.fn())
    const toolbar = findRaw(api.tree, 'toolbar')
    if (!toolbar?.children) throw new Error('invalid test tree')

    api.onImportBegan.emit()
    const imported: BrowserBookmarkTreeNode = {
      id: 'imported',
      parentId: 'toolbar',
      title: 'Imported',
      url: 'https://imported.example',
    }
    toolbar.children.push(imported)
    api.onCreated.emit(imported.id, imported)
    expect((await repository.getTree()).nodes.has('imported')).toBe(false)

    api.onImportEnded.emit()
    await vi.waitFor(() => expect(api.getTreeCalls).toBe(2))
    expect((await repository.getTree()).nodes.has('imported')).toBe(true)
    unsubscribe()
  })
})
