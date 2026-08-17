import type { BookmarkTree, DisplayedFolder } from '../types'
import { getDescendantIds } from './tree'

function orderedSelections(selections: readonly DisplayedFolder[]): DisplayedFolder[] {
  return selections
    .map((selection, inputOrder) => ({ selection, inputOrder }))
    .sort(
      (left, right) =>
        left.selection.order - right.selection.order || left.inputOrder - right.inputOrder,
    )
    .map(({ selection }) => selection)
}

function hasSubtreeAncestor(
  tree: BookmarkTree,
  folderId: string,
  subtreeFolderIds: ReadonlySet<string>,
): boolean {
  let parentId = tree.nodes.get(folderId)?.parentId ?? null
  const visited = new Set<string>([folderId])
  while (parentId) {
    if (visited.has(parentId)) return false
    visited.add(parentId)
    if (subtreeFolderIds.has(parentId)) return true
    parentId = tree.nodes.get(parentId)?.parentId ?? null
  }
  return false
}

export function normalizeDisplayedFolders(
  tree: BookmarkTree,
  selections: readonly DisplayedFolder[],
): DisplayedFolder[] {
  const seen = new Set<string>()
  const valid = orderedSelections(selections).filter((selection) => {
    const node = tree.nodes.get(selection.folderId)
    if (
      !node ||
      node.kind !== 'folder' ||
      node.parentId === null ||
      seen.has(node.id) ||
      (selection.scope !== 'direct' && selection.scope !== 'subtree')
    ) {
      return false
    }
    seen.add(node.id)
    return true
  })
  const subtreeFolderIds = new Set(
    valid.filter((selection) => selection.scope === 'subtree').map(({ folderId }) => folderId),
  )

  return valid
    .filter((selection) => !hasSubtreeAncestor(tree, selection.folderId, subtreeFolderIds))
    .map((selection, order) => ({ ...selection, order }))
}

export function isFolderCovered(
  tree: BookmarkTree,
  folderId: string,
  selections: readonly DisplayedFolder[],
): boolean {
  const normalized = normalizeDisplayedFolders(tree, selections)
  const subtreeFolderIds = new Set(
    normalized
      .filter((selection) => selection.scope === 'subtree')
      .map((selection) => selection.folderId),
  )
  return hasSubtreeAncestor(tree, folderId, subtreeFolderIds)
}

export function resolveDisplayedBookmarkIds(
  tree: BookmarkTree,
  selections: readonly DisplayedFolder[],
): Set<string> {
  const bookmarkIds = new Set<string>()

  for (const selection of normalizeDisplayedFolders(tree, selections)) {
    const folder = tree.nodes.get(selection.folderId)
    if (!folder) continue
    const candidateIds =
      selection.scope === 'subtree' ? getDescendantIds(tree, folder.id) : folder.childIds
    for (const id of candidateIds) {
      if (tree.nodes.get(id)?.kind === 'bookmark') bookmarkIds.add(id)
    }
  }

  return bookmarkIds
}
