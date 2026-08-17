import { browser } from 'wxt/browser'

import type {
  BookmarkCapabilities,
  BookmarkDraft,
  BookmarkMove,
  BookmarkNode,
  BookmarkRepository,
  BookmarkTree,
  BookmarkUpdate,
} from '../types'
import {
  BookmarkTreeFormatError,
  normalizeBookmarkTree,
  type BrowserBookmarkTreeNode,
} from './tree'

type EventListener<TArgs extends unknown[]> = (...args: TArgs) => void

interface BrowserEvent<TArgs extends unknown[]> {
  addListener(listener: EventListener<TArgs>): void
  removeListener(listener: EventListener<TArgs>): void
}

interface CreateDetails {
  parentId: string
  title: string
  url?: string
  index?: number
}

interface UpdateChanges {
  title?: string
  url?: string
}

interface MoveDestination {
  parentId: string
  index?: number
}

interface ChangeInfo {
  title?: string
  url?: string
}

interface MoveInfo {
  parentId: string
  index: number
  oldParentId: string
  oldIndex: number
}

interface RemoveInfo {
  parentId: string
  index: number
  node: BrowserBookmarkTreeNode
}

export interface BookmarksApiPort {
  getTree(): Promise<BrowserBookmarkTreeNode[]>
  create(details: CreateDetails): Promise<BrowserBookmarkTreeNode>
  update(id: string, changes: UpdateChanges): Promise<BrowserBookmarkTreeNode>
  move(id: string, destination: MoveDestination): Promise<BrowserBookmarkTreeNode>
  remove(id: string): Promise<void>
  removeTree(id: string): Promise<void>
  onChanged: BrowserEvent<[id: string, changeInfo: ChangeInfo]>
  onChildrenReordered?: BrowserEvent<[id: string, reorderInfo: { childIds: string[] }]>
  onCreated: BrowserEvent<[id: string, bookmark: BrowserBookmarkTreeNode]>
  onImportBegan?: BrowserEvent<[]>
  onImportEnded?: BrowserEvent<[]>
  onMoved: BrowserEvent<[id: string, moveInfo: MoveInfo]>
  onRemoved: BrowserEvent<[id: string, removeInfo: RemoveInfo]>
}

export type BookmarkRepositoryErrorCode =
  | 'bookmark_missing'
  | 'destination_missing'
  | 'destination_not_folder'
  | 'root_read_only'
  | 'managed_read_only'
  | 'invalid_url'
  | 'invalid_index'
  | 'invalid_kind'
  | 'descendant_move'
  | 'folder_not_empty'

export class BookmarkRepositoryError extends Error {
  constructor(
    public readonly code: BookmarkRepositoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BookmarkRepositoryError'
  }
}

const ALLOWED_BOOKMARK_PROTOCOLS = new Set([
  'http:',
  'https:',
  'ftp:',
  'file:',
  'mailto:',
  'tel:',
  'about:',
  'chrome:',
  'edge:',
  'brave:',
  'opera:',
  'vivaldi:',
])

export function normalizeBookmarkUrl(value: string): string {
  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (!normalized || hasControlCharacter) {
    throw new BookmarkRepositoryError('invalid_url', 'Bookmark URL is empty or malformed.')
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new BookmarkRepositoryError('invalid_url', 'Bookmark URL must be absolute.')
  }

  if (!ALLOWED_BOOKMARK_PROTOCOLS.has(parsed.protocol.toLocaleLowerCase())) {
    throw new BookmarkRepositoryError(
      'invalid_url',
      `Bookmark URL protocol is not allowed: ${parsed.protocol}`,
    )
  }
  return normalized
}

function createBrowserBookmarksApi(): BookmarksApiPort {
  const optionalEvent = <TArgs extends unknown[]>(
    event: BrowserEvent<TArgs> | undefined,
  ): BrowserEvent<TArgs> | undefined => {
    if (!event) return undefined
    return {
      addListener: (listener) => event.addListener(listener),
      removeListener: (listener) => event.removeListener(listener),
    }
  }

  const onChildrenReordered = optionalEvent(browser.bookmarks.onChildrenReordered)
  const onImportBegan = optionalEvent(browser.bookmarks.onImportBegan)
  const onImportEnded = optionalEvent(browser.bookmarks.onImportEnded)

  return {
    getTree: () => browser.bookmarks.getTree(),
    create: (details) => browser.bookmarks.create(details),
    update: (id, changes) => browser.bookmarks.update(id, changes),
    move: (id, destination) => browser.bookmarks.move(id, destination),
    remove: (id) => browser.bookmarks.remove(id),
    removeTree: (id) => browser.bookmarks.removeTree(id),
    onChanged: {
      addListener: (listener) => browser.bookmarks.onChanged.addListener(listener),
      removeListener: (listener) => browser.bookmarks.onChanged.removeListener(listener),
    },
    ...(onChildrenReordered ? { onChildrenReordered } : {}),
    onCreated: {
      addListener: (listener) => browser.bookmarks.onCreated.addListener(listener),
      removeListener: (listener) => browser.bookmarks.onCreated.removeListener(listener),
    },
    ...(onImportBegan ? { onImportBegan } : {}),
    ...(onImportEnded ? { onImportEnded } : {}),
    onMoved: {
      addListener: (listener) => browser.bookmarks.onMoved.addListener(listener),
      removeListener: (listener) => browser.bookmarks.onMoved.removeListener(listener),
    },
    onRemoved: {
      addListener: (listener) => browser.bookmarks.onRemoved.addListener(listener),
      removeListener: (listener) => browser.bookmarks.onRemoved.removeListener(listener),
    },
  }
}

function withNodes(tree: BookmarkTree, nodes: Map<string, BookmarkNode>): BookmarkTree {
  return { nodes, rootIds: tree.rootIds, revision: tree.revision + 1 }
}

function reindexChildren(
  nodes: Map<string, BookmarkNode>,
  parentId: string,
  childIds: readonly string[],
): void {
  const parent = nodes.get(parentId)
  if (!parent) throw new BookmarkTreeFormatError(`Missing parent node: ${parentId}`)
  nodes.set(parentId, { ...parent, childIds: [...childIds] })
  childIds.forEach((childId, index) => {
    const child = nodes.get(childId)
    if (!child) throw new BookmarkTreeFormatError(`Missing child node: ${childId}`)
    nodes.set(childId, { ...child, parentId, index })
  })
}

function insertNode(tree: BookmarkTree, raw: BrowserBookmarkTreeNode): BookmarkTree | null {
  const id = String(raw.id)
  if (tree.nodes.has(id)) return null
  if (!raw.parentId) throw new BookmarkTreeFormatError(`Created node ${id} has no parent.`)

  const parent = tree.nodes.get(raw.parentId)
  if (!parent || parent.kind !== 'folder') {
    throw new BookmarkTreeFormatError(`Created node ${id} has an unknown parent.`)
  }

  const rawTree = normalizeBookmarkTree(
    [{ ...raw, children: raw.children ?? [] }],
    tree.revision,
    parent,
  )
  const createdRoot = rawTree.nodes.get(id)
  if (!createdRoot) throw new BookmarkTreeFormatError(`Could not normalize created node: ${id}`)

  const nodes = new Map(tree.nodes)
  for (const rawNode of rawTree.nodes.values()) {
    nodes.set(rawNode.id, rawNode)
  }

  const index = Math.min(Math.max(raw.index ?? parent.childIds.length, 0), parent.childIds.length)
  const childIds = [...parent.childIds]
  childIds.splice(index, 0, id)
  reindexChildren(nodes, parent.id, childIds)
  return withNodes(tree, nodes)
}

function updateNode(tree: BookmarkTree, id: string, changes: ChangeInfo): BookmarkTree | null {
  const current = tree.nodes.get(id)
  if (!current) throw new BookmarkTreeFormatError(`Changed node is missing: ${id}`)

  const title = changes.title ?? current.title
  const url = changes.url === undefined ? current.url : changes.url
  if (title === current.title && url === current.url) return null

  const nodes = new Map(tree.nodes)
  nodes.set(id, { ...current, title, url })
  return withNodes(tree, nodes)
}

function moveNode(
  tree: BookmarkTree,
  id: string,
  parentId: string,
  index: number,
): BookmarkTree | null {
  const current = tree.nodes.get(id)
  const destination = tree.nodes.get(parentId)
  if (!current || !current.parentId || !destination || destination.kind !== 'folder') {
    throw new BookmarkTreeFormatError(`Cannot apply move for node: ${id}`)
  }
  if (destination.pathIds.includes(id)) {
    throw new BookmarkTreeFormatError(`Cannot move ${id} into its descendant.`)
  }

  const oldParent = tree.nodes.get(current.parentId)
  if (!oldParent) throw new BookmarkTreeFormatError(`Missing old parent for node: ${id}`)
  const sameParent = oldParent.id === destination.id
  const oldChildren = oldParent.childIds.filter((childId) => childId !== id)
  const destinationChildren = sameParent
    ? oldChildren
    : destination.childIds.filter((childId) => childId !== id)
  const targetIndex = Math.min(Math.max(index, 0), destinationChildren.length)
  destinationChildren.splice(targetIndex, 0, id)

  if (
    sameParent &&
    oldParent.childIds.length === destinationChildren.length &&
    oldParent.childIds.every((childId, childIndex) => childId === destinationChildren[childIndex])
  ) {
    return null
  }

  const nodes = new Map(tree.nodes)
  if (!sameParent) reindexChildren(nodes, oldParent.id, oldChildren)
  reindexChildren(nodes, destination.id, destinationChildren)

  const moved = nodes.get(id)
  if (!moved) throw new BookmarkTreeFormatError(`Moved node is missing: ${id}`)
  nodes.set(id, {
    ...moved,
    parentId: destination.id,
    depth: destination.depth + 1,
    pathIds: [...destination.pathIds, id],
  })

  const stack = [...moved.childIds]
  while (stack.length > 0) {
    const childId = stack.pop()
    if (!childId) continue
    const child = nodes.get(childId)
    if (!child || !child.parentId) {
      throw new BookmarkTreeFormatError(`Moved descendant is missing: ${childId}`)
    }
    const parent = nodes.get(child.parentId)
    if (!parent) throw new BookmarkTreeFormatError(`Moved descendant parent is missing: ${childId}`)
    nodes.set(childId, {
      ...child,
      depth: parent.depth + 1,
      pathIds: [...parent.pathIds, childId],
    })
    stack.push(...child.childIds)
  }

  return withNodes(tree, nodes)
}

function removeNode(tree: BookmarkTree, id: string): BookmarkTree | null {
  const current = tree.nodes.get(id)
  if (!current) return null
  if (!current.parentId) throw new BookmarkTreeFormatError(`Cannot remove root node: ${id}`)

  const parent = tree.nodes.get(current.parentId)
  if (!parent) throw new BookmarkTreeFormatError(`Missing parent for removed node: ${id}`)
  const nodes = new Map(tree.nodes)
  const stack = [id]
  while (stack.length > 0) {
    const removedId = stack.pop()
    if (!removedId) continue
    const removed = nodes.get(removedId)
    if (!removed) continue
    stack.push(...removed.childIds)
    nodes.delete(removedId)
  }
  reindexChildren(
    nodes,
    parent.id,
    parent.childIds.filter((childId) => childId !== id),
  )
  return withNodes(tree, nodes)
}

function reorderChildren(
  tree: BookmarkTree,
  parentId: string,
  childIds: string[],
): BookmarkTree | null {
  const parent = tree.nodes.get(parentId)
  if (!parent || parent.kind !== 'folder') {
    throw new BookmarkTreeFormatError(`Reordered parent is missing: ${parentId}`)
  }
  const expected = new Set(parent.childIds)
  if (childIds.length !== expected.size || childIds.some((id) => !expected.has(id))) {
    throw new BookmarkTreeFormatError(`Reordered children do not match parent: ${parentId}`)
  }
  if (parent.childIds.every((id, index) => id === childIds[index])) return null

  const nodes = new Map(tree.nodes)
  reindexChildren(nodes, parentId, childIds)
  return withNodes(tree, nodes)
}

interface Subscriber {
  onChange: () => void
  onError: ((error: Error) => void) | undefined
}

export class BrowserBookmarkRepository implements BookmarkRepository {
  private tree: BookmarkTree | null = null
  private loadPromise: Promise<BookmarkTree> | null = null
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly subscribers = new Set<Subscriber>()
  private listenerRemovers: Array<() => void> = []
  private listenersAttached = false
  private notifyScheduled = false
  private reloadScheduled = false
  private importInProgress = false

  constructor(private readonly api: BookmarksApiPort = createBrowserBookmarksApi()) {}

  async getTree(): Promise<BookmarkTree> {
    return this.tree ?? this.loadFresh()
  }

  async refresh(): Promise<BookmarkTree> {
    const tree = await this.loadFresh()
    this.scheduleNotification()
    return tree
  }

  async create(draft: BookmarkDraft): Promise<BookmarkNode> {
    return this.enqueueMutation(async () => {
      const tree = await this.getTree()
      const parent = this.requireDestination(tree, draft.parentId)
      this.assertWritableTarget(parent)
      this.validateIndex(draft.index)
      const normalizedUrl = draft.url === undefined ? undefined : normalizeBookmarkUrl(draft.url)
      const details: CreateDetails = {
        parentId: parent.id,
        title: draft.title,
        ...(normalizedUrl === undefined ? {} : { url: normalizedUrl }),
        ...(draft.index === undefined ? {} : { index: draft.index }),
      }

      const created = await this.api.create(details)
      await this.applyAfterMutation((current) => insertNode(current, created))
      const createdNode = this.tree?.nodes.get(created.id)
      if (!createdNode) throw new BookmarkTreeFormatError(`Created node is missing: ${created.id}`)
      return createdNode
    })
  }

  async update(id: string, changes: BookmarkUpdate): Promise<void> {
    await this.enqueueMutation(async () => {
      const tree = await this.getTree()
      const node = this.requireNode(tree, id)
      this.assertMutable(node)
      if (changes.url !== undefined && node.kind !== 'bookmark') {
        throw new BookmarkRepositoryError('invalid_kind', 'Only bookmarks can have a URL.')
      }

      const normalizedUrl =
        changes.url === undefined ? undefined : normalizeBookmarkUrl(changes.url)
      const apiChanges: UpdateChanges = {
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(normalizedUrl === undefined ? {} : { url: normalizedUrl }),
      }
      if (Object.keys(apiChanges).length === 0) return

      const updated = await this.api.update(id, apiChanges)
      await this.applyAfterMutation((current) =>
        updateNode(current, id, {
          title: updated.title,
          ...(updated.url === undefined ? {} : { url: updated.url }),
        }),
      )
    })
  }

  async move(id: string, destination: BookmarkMove): Promise<void> {
    await this.enqueueMutation(async () => {
      const tree = await this.getTree()
      const node = this.requireNode(tree, id)
      this.assertMutable(node)
      const parent = this.requireDestination(tree, destination.parentId)
      this.assertWritableTarget(parent)
      this.validateIndex(destination.index)
      if (parent.id === node.id || parent.pathIds.includes(node.id)) {
        throw new BookmarkRepositoryError(
          'descendant_move',
          'A folder cannot be moved into itself or one of its descendants.',
        )
      }

      const moved = await this.api.move(id, {
        parentId: parent.id,
        ...(destination.index === undefined ? {} : { index: destination.index }),
      })
      const fallbackIndex =
        destination.index ??
        Math.max(0, parent.childIds.length - (node.parentId === parent.id ? 1 : 0))
      await this.applyAfterMutation((current) =>
        moveNode(current, id, moved.parentId ?? parent.id, moved.index ?? fallbackIndex),
      )
    })
  }

  async remove(id: string, recursive: boolean): Promise<void> {
    await this.enqueueMutation(async () => {
      const tree = await this.getTree()
      const node = this.requireNode(tree, id)
      this.assertMutable(node)
      if (node.kind === 'folder' && node.childIds.length > 0 && !recursive) {
        throw new BookmarkRepositoryError(
          'folder_not_empty',
          'A non-empty folder requires recursive removal.',
        )
      }

      if (node.kind === 'folder' && recursive) await this.api.removeTree(id)
      else await this.api.remove(id)
      await this.applyAfterMutation((current) => removeNode(current, id))
    })
  }

  async getCapabilities(id: string): Promise<BookmarkCapabilities> {
    const node = (await this.getTree()).nodes.get(id)
    if (!node) {
      return {
        canRename: false,
        canMove: false,
        canRemove: false,
        canAcceptChildren: false,
        reason: 'missing',
      }
    }
    return {
      canRename: node.selfModifiable,
      canMove: node.selfModifiable,
      canRemove: node.selfModifiable,
      canAcceptChildren: node.childrenWritable,
      reason: node.restriction,
    }
  }

  subscribe(onChange: () => void, onError?: (error: Error) => void): () => void {
    const subscriber: Subscriber = { onChange, onError }
    this.subscribers.add(subscriber)
    try {
      this.attachListeners()
    } catch (error) {
      this.subscribers.delete(subscriber)
      throw error
    }
    return () => {
      this.subscribers.delete(subscriber)
      if (this.subscribers.size === 0) this.detachListeners()
    }
  }

  private async loadFresh(): Promise<BookmarkTree> {
    if (this.loadPromise) return this.loadPromise
    const nextRevision = (this.tree?.revision ?? -1) + 1
    this.loadPromise = this.api
      .getTree()
      .then((rawTree) => {
        const normalized = normalizeBookmarkTree(rawTree, nextRevision)
        this.tree = normalized
        return normalized
      })
      .finally(() => {
        this.loadPromise = null
      })
    return this.loadPromise
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async applyAfterMutation(
    apply: (tree: BookmarkTree) => BookmarkTree | null,
  ): Promise<void> {
    const tree = await this.getTree()
    try {
      const next = apply(tree)
      if (next) {
        this.tree = next
        this.scheduleNotification()
      }
    } catch (error) {
      await this.loadFresh()
      this.scheduleNotification()
      if (!(error instanceof BookmarkTreeFormatError)) throw error
    }
  }

  private requireNode(tree: BookmarkTree, id: string): BookmarkNode {
    const node = tree.nodes.get(id)
    if (!node) throw new BookmarkRepositoryError('bookmark_missing', `Bookmark not found: ${id}`)
    return node
  }

  private requireDestination(tree: BookmarkTree, id: string): BookmarkNode {
    const node = tree.nodes.get(id)
    if (!node) {
      throw new BookmarkRepositoryError('destination_missing', `Destination not found: ${id}`)
    }
    if (node.kind !== 'folder') {
      throw new BookmarkRepositoryError(
        'destination_not_folder',
        `Destination is not a folder: ${id}`,
      )
    }
    return node
  }

  private assertMutable(node: BookmarkNode): void {
    if (node.selfModifiable) return
    if (node.restriction === 'managed') {
      throw new BookmarkRepositoryError('managed_read_only', 'Managed bookmarks are read-only.')
    }
    throw new BookmarkRepositoryError('root_read_only', 'Browser root nodes are read-only.')
  }

  private assertWritableTarget(node: BookmarkNode): void {
    if (node.childrenWritable) return
    if (node.restriction === 'managed') {
      throw new BookmarkRepositoryError('managed_read_only', 'Managed bookmarks are read-only.')
    }
    throw new BookmarkRepositoryError('root_read_only', 'Browser root nodes are read-only.')
  }

  private validateIndex(index: number | undefined): void {
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      throw new BookmarkRepositoryError('invalid_index', 'Bookmark index must be non-negative.')
    }
  }

  private applyExternal(apply: (tree: BookmarkTree) => BookmarkTree | null): void {
    if (!this.tree) {
      this.scheduleReload()
      return
    }
    try {
      const next = apply(this.tree)
      if (next) {
        this.tree = next
        this.scheduleNotification()
      }
    } catch (error) {
      if (error instanceof BookmarkTreeFormatError) this.scheduleReload()
      else this.emitError(error)
    }
  }

  private scheduleReload(): void {
    if (this.importInProgress) return
    if (this.reloadScheduled) return
    this.reloadScheduled = true
    queueMicrotask(() => {
      this.reloadScheduled = false
      void this.loadFresh()
        .then(() => this.scheduleNotification())
        .catch((error: unknown) => this.emitError(error))
    })
  }

  private scheduleNotification(): void {
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    queueMicrotask(() => {
      this.notifyScheduled = false
      for (const subscriber of this.subscribers) subscriber.onChange()
    })
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error))
    const handlers = [...this.subscribers]
      .map((subscriber) => subscriber.onError)
      .filter((handler): handler is (error: Error) => void => handler !== undefined)
    if (handlers.length === 0) {
      console.error('Bookmark repository event failed.', normalized)
      return
    }
    handlers.forEach((handler) => handler(normalized))
  }

  private readonly onChanged = (id: string, changes: ChangeInfo): void => {
    this.applyExternal((tree) => updateNode(tree, id, changes))
  }

  private readonly onChildrenReordered = (
    id: string,
    reorderInfo: { childIds: string[] },
  ): void => {
    this.applyExternal((tree) => reorderChildren(tree, id, reorderInfo.childIds))
  }

  private readonly onCreated = (_id: string, bookmark: BrowserBookmarkTreeNode): void => {
    if (this.importInProgress) return
    this.applyExternal((tree) => insertNode(tree, bookmark))
  }

  private readonly onImportBegan = (): void => {
    this.importInProgress = true
  }

  private readonly onImportEnded = (): void => {
    this.importInProgress = false
    this.scheduleReload()
  }

  private readonly onMoved = (id: string, moveInfo: MoveInfo): void => {
    this.applyExternal((tree) => moveNode(tree, id, moveInfo.parentId, moveInfo.index))
  }

  private readonly onRemoved = (id: string): void => {
    this.applyExternal((tree) => removeNode(tree, id))
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    const removers: Array<() => void> = []
    const register = <TArgs extends unknown[]>(
      event: BrowserEvent<TArgs> | undefined,
      listener: EventListener<TArgs>,
    ): void => {
      if (!event) return
      event.addListener(listener)
      removers.push(() => event.removeListener(listener))
    }

    try {
      register(this.api.onChanged, this.onChanged)
      register(this.api.onChildrenReordered, this.onChildrenReordered)
      register(this.api.onCreated, this.onCreated)
      register(this.api.onImportBegan, this.onImportBegan)
      register(this.api.onImportEnded, this.onImportEnded)
      register(this.api.onMoved, this.onMoved)
      register(this.api.onRemoved, this.onRemoved)
    } catch (error) {
      for (const removeListener of removers.reverse()) {
        try {
          removeListener()
        } catch (cleanupError) {
          console.error('Bookmark listener cleanup failed.', cleanupError)
        }
      }
      throw error
    }

    this.listenerRemovers = removers
    this.listenersAttached = true
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return
    this.listenersAttached = false
    const removers = this.listenerRemovers.splice(0).reverse()
    for (const removeListener of removers) {
      try {
        removeListener()
      } catch (error) {
        this.emitError(error)
      }
    }
    this.importInProgress = false
    this.tree = null
  }
}
