<script setup lang="ts">
/* global Event, HTMLElement */

import { computed, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Folder, FolderSearch, Minus, Search } from '@lucide/vue'

import {
  countBookmarks,
  formatBookmarkPath,
  normalizeDisplayedFolders,
} from '../../../src/core/bookmarks'
import type { BookmarkNode, BookmarkTree, DisplayedFolder } from '../../../src/core/types'

const props = defineProps<{
  tree: BookmarkTree
  selections: readonly DisplayedFolder[]
}>()

const emit = defineEmits<{
  'update:selections': [selections: DisplayedFolder[]]
}>()

interface FolderRow {
  node: BookmarkNode
  depth: number
  path: string
  bookmarkCount: number
  hasFolders: boolean
}

const ROW_HEIGHT = 58
const OVERSCAN = 7
const query = ref('')
const expandedIds = ref<Set<string>>(new Set())
const scrollTop = ref(0)
const viewportHeight = ref(430)

function topLevelFolderIds(tree: BookmarkTree): string[] {
  return tree.rootIds.flatMap((rootId) => {
    const root = tree.nodes.get(rootId)
    return (
      root?.childIds.filter((id) => {
        const child = tree.nodes.get(id)
        return child?.kind === 'folder'
      }) ?? []
    )
  })
}

watch(
  () => props.tree.revision,
  () => {
    if (expandedIds.value.size > 0) return
    expandedIds.value = new Set(topLevelFolderIds(props.tree))
  },
  { immediate: true },
)

function orderedFolderIds(): string[] {
  const result: string[] = []
  const stack = [...topLevelFolderIds(props.tree)].reverse()
  while (stack.length > 0) {
    const id = stack.pop()
    if (!id) continue
    const node = props.tree.nodes.get(id)
    if (!node || node.kind !== 'folder') continue
    result.push(id)
    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = node.childIds[index]
      if (childId && props.tree.nodes.get(childId)?.kind === 'folder') stack.push(childId)
    }
  }
  return result
}

const matchedIds = computed(() => {
  const normalized = query.value.trim().normalize('NFKC').toLocaleLowerCase()
  if (!normalized) return null

  const included = new Set<string>()
  for (const id of orderedFolderIds()) {
    const node = props.tree.nodes.get(id)
    if (!node) continue
    const path = formatBookmarkPath(props.tree, id, true)
    const searchable = `${node.title}\n${path}`.normalize('NFKC').toLocaleLowerCase()
    if (!searchable.includes(normalized)) continue
    node.pathIds.forEach((pathId) => {
      if (props.tree.nodes.get(pathId)?.parentId !== null) included.add(pathId)
    })
  }
  return included
})

const rows = computed<FolderRow[]>(() => {
  const result: FolderRow[] = []
  const roots = topLevelFolderIds(props.tree)
  const stack = roots.map((id) => ({ id, depth: 0 })).reverse()

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const node = props.tree.nodes.get(current.id)
    if (!node || node.kind !== 'folder') continue
    if (matchedIds.value && !matchedIds.value.has(node.id)) continue
    const folderChildren = node.childIds.filter(
      (childId) => props.tree.nodes.get(childId)?.kind === 'folder',
    )
    result.push({
      node,
      depth: current.depth,
      path: formatBookmarkPath(props.tree, node.id, true) || node.title || '未命名文件夹',
      bookmarkCount: countBookmarks(props.tree, node.id, true),
      hasFolders: folderChildren.length > 0,
    })

    if (!matchedIds.value && !expandedIds.value.has(node.id)) continue
    for (let index = folderChildren.length - 1; index >= 0; index -= 1) {
      const childId = folderChildren[index]
      if (childId) stack.push({ id: childId, depth: current.depth + 1 })
    }
  }
  return result
})

const windowStart = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN))
const windowEnd = computed(() =>
  Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN,
  ),
)
const visibleRows = computed(() => rows.value.slice(windowStart.value, windowEnd.value))
const selectedMap = computed(
  () => new Map(props.selections.map((selection) => [selection.folderId, selection])),
)

function isCovered(node: BookmarkNode): boolean {
  let parentId = node.parentId
  while (parentId) {
    if (selectedMap.value.get(parentId)?.scope === 'subtree') return true
    parentId = props.tree.nodes.get(parentId)?.parentId ?? null
  }
  return false
}

function hasSelectedDescendant(node: BookmarkNode): boolean {
  return props.selections.some((selection) => {
    if (selection.folderId === node.id) return false
    return props.tree.nodes.get(selection.folderId)?.pathIds.includes(node.id) === true
  })
}

function checkedState(node: BookmarkNode): 'true' | 'false' | 'mixed' {
  if (selectedMap.value.has(node.id) || isCovered(node)) return 'true'
  return hasSelectedDescendant(node) ? 'mixed' : 'false'
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function toggleSelection(node: BookmarkNode): void {
  if (isCovered(node)) return
  const next = props.selections.filter(({ folderId }) => folderId !== node.id)
  if (!selectedMap.value.has(node.id)) {
    next.push({ folderId: node.id, scope: 'subtree', order: next.length })
  }
  emit('update:selections', normalizeDisplayedFolders(props.tree, next))
}

function selectAll(): void {
  const next = topLevelFolderIds(props.tree).map((folderId, order) => ({
    folderId,
    scope: 'subtree' as const,
    order,
  }))
  emit('update:selections', normalizeDisplayedFolders(props.tree, next))
}

function handleScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement
  scrollTop.value = element.scrollTop
  viewportHeight.value = element.clientHeight
}
</script>

<template>
  <div class="folder-picker" data-jtab-component="folder-picker">
    <div class="folder-picker__toolbar">
      <label class="search-field" data-jtab-role="folder-search">
        <Search :size="17" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="搜索文件夹或完整路径" />
      </label>
      <div class="folder-picker__actions">
        <button class="text-button" type="button" @click="selectAll">全选</button>
        <button
          class="text-button"
          type="button"
          :disabled="selections.length === 0"
          @click="emit('update:selections', [])"
        >
          清空
        </button>
      </div>
    </div>

    <div class="tree-summary" aria-live="polite">
      <span>{{ rows.length }} 个文件夹</span>
      <span>{{ selections.length }} 个首页入口</span>
    </div>

    <div class="folder-tree" role="tree" tabindex="0" @scroll="handleScroll">
      <div
        v-if="rows.length"
        class="folder-tree__canvas"
        :style="{ height: `${rows.length * ROW_HEIGHT}px` }"
      >
        <div
          v-for="(row, index) in visibleRows"
          :key="row.node.id"
          class="folder-row"
          :class="{ 'is-covered': isCovered(row.node) }"
          :style="{
            height: `${ROW_HEIGHT}px`,
            transform: `translateY(${(windowStart + index) * ROW_HEIGHT}px)`,
          }"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-expanded="
            row.hasFolders ? expandedIds.has(row.node.id) || Boolean(matchedIds) : undefined
          "
          :aria-selected="checkedState(row.node) === 'true'"
        >
          <div class="folder-row__indent" :style="{ width: `${Math.min(row.depth, 12) * 18}px` }" />
          <button
            v-if="row.hasFolders"
            class="icon-button icon-button--small"
            type="button"
            :aria-label="expandedIds.has(row.node.id) ? '折叠文件夹' : '展开文件夹'"
            @click="toggleExpanded(row.node.id)"
          >
            <ChevronDown v-if="expandedIds.has(row.node.id) || matchedIds" :size="16" />
            <ChevronRight v-else :size="16" />
          </button>
          <span v-else class="folder-row__spacer" />
          <button
            class="tree-checkbox"
            :class="{
              'is-checked': checkedState(row.node) === 'true',
              'is-mixed': checkedState(row.node) === 'mixed',
            }"
            type="button"
            role="checkbox"
            :aria-checked="checkedState(row.node)"
            :disabled="isCovered(row.node)"
            :aria-label="`选择 ${row.path}`"
            @click="toggleSelection(row.node)"
          >
            <Check v-if="checkedState(row.node) === 'true'" :size="14" stroke-width="3" />
            <Minus v-else-if="checkedState(row.node) === 'mixed'" :size="14" stroke-width="3" />
          </button>
          <Folder
            :size="18"
            class="folder-row__icon"
            data-jtab-role="folder-icon"
            aria-hidden="true"
          />
          <div class="folder-row__label">
            <strong>{{ row.node.title || '未命名文件夹' }}</strong>
            <span :title="row.path">{{ row.path }}</span>
          </div>
          <span class="folder-row__count">{{ row.bookmarkCount }}</span>
        </div>
      </div>
      <div v-else class="folder-tree__empty">
        <FolderSearch :size="24" aria-hidden="true" />
        <span>没有匹配的文件夹</span>
      </div>
    </div>
  </div>
</template>
