<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Folder, FolderOpen, Search, X } from '@lucide/vue'

import { countBookmarks, formatBookmarkPath } from '../../../src/core/bookmarks'
import type { BookmarkNode, BookmarkTree } from '../../../src/core/types'

const props = defineProps<{
  tree: BookmarkTree
  rootId: string
  currentId: string
}>()

const emit = defineEmits<{
  select: [folderId: string]
}>()

const query = ref('')

interface FolderRow {
  node: BookmarkNode
  depth: number
  path: string
  bookmarkCount: number
}

const rows = computed<FolderRow[]>(() => {
  const root = props.tree.nodes.get(props.rootId)
  if (!root || root.kind !== 'folder') return []
  const output: FolderRow[] = []
  const stack: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    const node = props.tree.nodes.get(current.id)
    if (!node || node.kind !== 'folder') continue
    output.push({
      node,
      depth: current.depth,
      path: formatBookmarkPath(props.tree, node.id, true),
      bookmarkCount: countBookmarks(props.tree, node.id),
    })
    const folders = node.childIds
      .map((id) => props.tree.nodes.get(id))
      .filter((child): child is BookmarkNode => child?.kind === 'folder')
      .sort((left, right) => left.index - right.index)
    for (let index = folders.length - 1; index >= 0; index -= 1) {
      const folder = folders[index]
      if (folder) stack.push({ id: folder.id, depth: current.depth + 1 })
    }
  }
  return output
})

const filteredRows = computed(() => {
  const normalized = query.value.trim().normalize('NFKC').toLocaleLowerCase()
  if (!normalized) return rows.value
  return rows.value.filter(({ path }) =>
    path.normalize('NFKC').toLocaleLowerCase().includes(normalized),
  )
})
</script>

<template>
  <div class="folder-tree" data-jtab-component="folder-tree">
    <label class="folder-tree__search">
      <Search :size="16" aria-hidden="true" />
      <span class="sr-only">搜索文件夹</span>
      <input v-model="query" type="search" placeholder="搜索文件夹" autocomplete="off" />
      <button v-if="query" type="button" title="清空搜索" @click="query = ''">
        <X :size="15" aria-hidden="true" />
      </button>
    </label>

    <nav class="folder-tree__list" aria-label="文件夹树">
      <button
        v-for="row in filteredRows"
        :key="row.node.id"
        type="button"
        class="folder-tree__row"
        :class="{ 'folder-tree__row--active': row.node.id === currentId }"
        :style="{ '--folder-depth': row.depth }"
        :title="row.path"
        :aria-current="row.node.id === currentId ? 'page' : undefined"
        @click="emit('select', row.node.id)"
      >
        <span class="folder-tree__chevron">
          <ChevronRight v-if="row.depth > 0" :size="14" aria-hidden="true" />
        </span>
        <span class="folder-tree__icon" data-jtab-role="folder-icon">
          <FolderOpen v-if="row.node.id === currentId" :size="17" aria-hidden="true" />
          <Folder v-else :size="17" aria-hidden="true" />
        </span>
        <span>{{ row.node.title || '未命名文件夹' }}</span>
        <small>{{ row.bookmarkCount }}</small>
      </button>
      <p v-if="filteredRows.length === 0" class="folder-tree__empty">没有匹配的文件夹</p>
    </nav>
  </div>
</template>
