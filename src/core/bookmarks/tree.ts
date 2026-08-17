import type { BookmarkKind, BookmarkNode, BookmarkRestriction, BookmarkTree } from '../types'

export interface BrowserBookmarkTreeNode {
  id: string
  parentId?: string
  title: string
  url?: string
  index?: number
  dateAdded?: number
  unmodifiable?: string
  folderType?: string
  type?: 'bookmark' | 'folder' | 'separator' | string
  children?: BrowserBookmarkTreeNode[]
}

export interface BookmarkSearchResult {
  node: BookmarkNode
  hostname: string
  path: string
  score: number
}

export interface BookmarkSearchOptions {
  allowedIds?: ReadonlySet<string>
  limit?: number
}

export class BookmarkTreeFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookmarkTreeFormatError'
  }
}

function getKind(node: BrowserBookmarkTreeNode): BookmarkKind {
  if (node.type === 'separator') return 'separator'
  if (node.type === 'bookmark' || typeof node.url === 'string') return 'bookmark'
  return 'folder'
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function getHostname(url: string | null): string {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    return parsed.hostname || parsed.protocol.slice(0, -1)
  } catch {
    return ''
  }
}

export function normalizeBookmarkTree(
  roots: readonly BrowserBookmarkTreeNode[],
  revision = 0,
  parent?: BookmarkNode,
): BookmarkTree {
  const nodes = new Map<string, BookmarkNode>()
  const rootIds = roots.map((root) => String(root.id))
  const stack: Array<{
    raw: BrowserBookmarkTreeNode
    parentId: string | null
    depth: number
    pathIds: string[]
    siblingIndex: number
    browserOwned: boolean
    treeRoot: boolean
    inheritedManaged: boolean
  }> = []

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index]
    if (!root) continue
    stack.push({
      raw: root,
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      pathIds: parent?.pathIds ?? [],
      siblingIndex: index,
      browserOwned: parent ? parent.parentId === null : true,
      treeRoot: parent === undefined,
      inheritedManaged: parent?.restriction === 'managed',
    })
  }

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break

    const id = String(current.raw.id)
    if (!id) throw new BookmarkTreeFormatError('Bookmark IDs must not be empty.')
    if (nodes.has(id)) throw new BookmarkTreeFormatError(`Duplicate bookmark ID: ${id}`)

    const kind = getKind(current.raw)
    const children = kind === 'folder' ? (current.raw.children ?? []) : []
    const pathIds = [...current.pathIds, id]
    const managed =
      current.inheritedManaged ||
      current.raw.unmodifiable !== undefined ||
      current.raw.folderType === 'managed'
    const restriction: BookmarkRestriction = managed
      ? 'managed'
      : current.browserOwned || current.raw.folderType !== undefined
        ? 'root'
        : null
    const node: BookmarkNode = {
      id,
      parentId: current.parentId,
      title: current.raw.title ?? '',
      url: kind === 'bookmark' ? (current.raw.url ?? '') : null,
      kind,
      index: current.raw.index ?? current.siblingIndex,
      depth: current.depth,
      pathIds,
      childIds: children.map((child) => String(child.id)),
      dateAdded: current.raw.dateAdded ?? null,
      folderType: current.raw.folderType ?? null,
      restriction,
      selfModifiable: restriction === null,
      childrenWritable: kind === 'folder' && restriction !== 'managed' && !current.treeRoot,
    }
    nodes.set(id, node)

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (!child) continue
      stack.push({
        raw: child,
        parentId: id,
        depth: current.depth + 1,
        pathIds,
        siblingIndex: index,
        browserOwned: current.treeRoot,
        treeRoot: false,
        inheritedManaged: managed,
      })
    }
  }

  return { nodes, rootIds, revision }
}

export function getBookmarkPath(
  tree: BookmarkTree,
  id: string,
  includeSelf = true,
): BookmarkNode[] {
  const node = tree.nodes.get(id)
  if (!node) return []

  const ids = includeSelf ? node.pathIds : node.pathIds.slice(0, -1)
  return ids.flatMap((pathId) => {
    const pathNode = tree.nodes.get(pathId)
    return pathNode ? [pathNode] : []
  })
}

export function formatBookmarkPath(tree: BookmarkTree, id: string, includeSelf = false): string {
  return getBookmarkPath(tree, id, includeSelf)
    .map((node) => node.title.trim())
    .filter(Boolean)
    .join(' / ')
}

export function getDescendantIds(tree: BookmarkTree, id: string): string[] {
  const root = tree.nodes.get(id)
  if (!root) return []

  const descendants: string[] = []
  const visited = new Set<string>([id])
  const stack = [...root.childIds].reverse()
  while (stack.length > 0) {
    const childId = stack.pop()
    if (!childId || visited.has(childId)) continue
    visited.add(childId)
    const child = tree.nodes.get(childId)
    if (!child) continue
    descendants.push(childId)
    for (let index = child.childIds.length - 1; index >= 0; index -= 1) {
      const nestedId = child.childIds[index]
      if (nestedId) stack.push(nestedId)
    }
  }
  return descendants
}

export function countDescendants(tree: BookmarkTree, id: string): number {
  return getDescendantIds(tree, id).length
}

export function countBookmarks(tree: BookmarkTree, id: string, recursive = true): number {
  const node = tree.nodes.get(id)
  if (!node) return 0

  const candidates = recursive ? getDescendantIds(tree, id) : node.childIds
  return candidates.reduce(
    (count, childId) => count + (tree.nodes.get(childId)?.kind === 'bookmark' ? 1 : 0),
    0,
  )
}

export function searchBookmarks(
  tree: BookmarkTree,
  query: string,
  options: BookmarkSearchOptions = {},
): BookmarkSearchResult[] {
  const terms = normalizeText(query).split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return []

  const limit = Math.max(0, options.limit ?? 50)
  const results: BookmarkSearchResult[] = []

  for (const node of tree.nodes.values()) {
    if (node.kind !== 'bookmark' || !node.url) continue
    if (options.allowedIds && !options.allowedIds.has(node.id)) continue

    const title = normalizeText(node.title)
    const hostname = getHostname(node.url)
    const normalizedHostname = normalizeText(hostname)
    const path = formatBookmarkPath(tree, node.id, false)
    const normalizedPath = normalizeText(path)
    const searchable = `${title}\n${normalizedHostname}\n${normalizedPath}`
    if (!terms.every((term) => searchable.includes(term))) continue

    const normalizedQuery = terms.join(' ')
    let score = 0
    if (title === normalizedQuery) score += 100
    else if (title.startsWith(normalizedQuery)) score += 60
    else if (title.includes(normalizedQuery)) score += 40
    if (normalizedHostname === normalizedQuery) score += 50
    else if (normalizedHostname.includes(normalizedQuery)) score += 25
    if (normalizedPath.includes(normalizedQuery)) score += 10

    results.push({ node, hostname, path, score })
  }

  return results
    .sort((left, right) => right.score - left.score || left.node.index - right.node.index)
    .slice(0, limit)
}
