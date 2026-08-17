import type { BookmarkNode, BookmarkTree, FolderScope } from '../types'

export interface FolderSection {
  folderId: string
  depth: number
  directBookmarkIds: string[]
  childFolderIds: string[]
  isExpanded: boolean
}

interface OrderedChild {
  node: BookmarkNode
  inputOrder: number
}

interface PendingFolder {
  folderId: string
  depth: number
  isRoot: boolean
}

function orderedChildren(tree: BookmarkTree, folder: BookmarkNode): BookmarkNode[] {
  const seen = new Set<string>()
  const children: OrderedChild[] = []

  folder.childIds.forEach((childId, inputOrder) => {
    if (seen.has(childId)) return
    seen.add(childId)

    const node = tree.nodes.get(childId)
    if (!node || (node.kind !== 'bookmark' && node.kind !== 'folder')) return
    children.push({ node, inputOrder })
  })

  return children
    .sort((left, right) => {
      const leftIndex = Number.isFinite(left.node.index) ? left.node.index : left.inputOrder
      const rightIndex = Number.isFinite(right.node.index) ? right.node.index : right.inputOrder
      return leftIndex - rightIndex || left.inputOrder - right.inputOrder
    })
    .map(({ node }) => node)
}

export function buildFolderSections(
  tree: BookmarkTree,
  rootId: string,
  scope: FolderScope,
  expandedFolderIds: ReadonlySet<string>,
): FolderSection[] {
  const root = tree.nodes.get(rootId)
  if (!root || root.kind !== 'folder') return []

  const sections: FolderSection[] = []
  const claimedFolderIds = new Set<string>([root.id])
  const pending: PendingFolder[] = [{ folderId: root.id, depth: 0, isRoot: true }]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break

    const folder = tree.nodes.get(current.folderId)
    if (!folder || folder.kind !== 'folder') continue

    const children = orderedChildren(tree, folder)
    const directBookmarkIds = children
      .filter((child) => child.kind === 'bookmark')
      .map((child) => child.id)
    const childFolderIds: string[] = []

    if (scope === 'subtree') {
      for (const child of children) {
        if (child.kind !== 'folder' || claimedFolderIds.has(child.id)) continue
        claimedFolderIds.add(child.id)
        childFolderIds.push(child.id)
      }
    }

    const isExpanded = current.isRoot || expandedFolderIds.has(folder.id)
    sections.push({
      folderId: folder.id,
      depth: current.depth,
      directBookmarkIds,
      childFolderIds,
      isExpanded,
    })

    if (scope !== 'subtree' || !isExpanded) continue
    for (let index = childFolderIds.length - 1; index >= 0; index -= 1) {
      const childFolderId = childFolderIds[index]
      if (!childFolderId) continue
      pending.push({ folderId: childFolderId, depth: current.depth + 1, isRoot: false })
    }
  }

  return sections
}
