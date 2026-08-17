<script setup lang="ts">
/* global Event, HTMLButtonElement, HTMLElement, HTMLIFrameElement, HTMLInputElement, HTMLStyleElement, KeyboardEvent, MessageEvent, MouseEvent, Node, URL, clearTimeout, document, location, navigator, setTimeout, window */

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  ImagePlus,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from '@lucide/vue'

import BookmarkIcon from './components/BookmarkIcon.vue'
import FolderTree from './components/FolderTree.vue'
import {
  BookmarkRepositoryError,
  BrowserBookmarkRepository,
  buildFolderSections,
  countBookmarks,
  countDescendants,
  formatBookmarkPath,
  getBookmarkPath,
  resolveDisplayedBookmarkIds,
  searchBookmarks,
  type FolderSection,
} from '../../src/core/bookmarks'
import { SEARCH_ENGINES } from '../../src/core/defaults'
import { getBookmarkHostname, type BookmarkIconSource } from '../../src/core/icons'
import { normalizeCustomSearchTemplate } from '../../src/core/search'
import type {
  BookmarkNode,
  BookmarkTree,
  DisplayedFolder,
  SearchEngineId,
} from '../../src/core/types'
import { localAssetRepository } from '../../src/services/assets'
import { passesCustomCssPrivacyBoundary } from '../../src/services/custom-css-privacy'
import { useSettingsStore } from '../../src/stores/settings'

const repository = new BrowserBookmarkRepository()
const settingsStore = useSettingsStore()
const { displayedFolders, error: settingsError, settings } = storeToRefs(settingsStore)
const DEFAULT_BACKGROUND_SRC = '/wallpapers/quiet-tide.webp'
const IS_FIREFOX = navigator.userAgent.includes('Firefox/')
const STANDARD_SEARCH_ENGINES = [
  { id: 'google', label: 'Google' },
  { id: 'bing', label: 'Bing' },
  { id: 'baidu', label: '百度' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
] as const satisfies ReadonlyArray<{ id: Exclude<SearchEngineId, 'custom'>; label: string }>

const tree = ref<BookmarkTree | null>(null)
const loading = ref(true)
const fatalError = ref('')
const activeEntryId = ref('')
const currentFolderId = ref('')
const drawerOpen = ref(false)
const manageMode = ref(false)
const actionMenuId = ref('')
const visibleLimit = ref(120)
const expandedFolderIds = ref<Set<string>>(new Set())
const folderVisibleLimits = reactive<Record<string, number>>({})
const contentGrid = ref<HTMLElement | null>(null)
const iconInput = ref<HTMLInputElement | null>(null)
const iconBookmarkId = ref('')
const searchWrap = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const searchEngineButton = ref<HTMLButtonElement | null>(null)
const searchQuery = ref('')
const searchFocused = ref(false)
const activeSearchIndex = ref(-1)
const searchEngineMenuOpen = ref(false)
const settingsOpen = ref(false)
const settingsButton = ref<HTMLButtonElement | null>(null)
const settingsCloseButton = ref<HTMLButtonElement | null>(null)
const settingsFrame = ref<HTMLIFrameElement | null>(null)
const backgroundUrl = ref(DEFAULT_BACKGROUND_SRC)
const backgroundFallback = ref(false)
const iconSources = reactive<Record<string, BookmarkIconSource>>({})
const iconRevision = reactive<Record<string, number>>({})
const toast = reactive({ visible: false, kind: 'success' as 'success' | 'error', message: '' })

type DialogMode = 'create-folder' | 'create-bookmark' | 'rename' | 'move' | 'delete' | null

const dialogMode = ref<DialogMode>(null)
const dialogNodeId = ref('')
const dialogTitle = ref('')
const dialogUrl = ref('')
const moveTargetId = ref('')
const submitting = ref(false)
const dialogFirstInput = ref<HTMLInputElement | null>(null)

let unsubscribeBookmarks: (() => void) | null = null
let sortable: Sortable | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let searchBlurTimer: ReturnType<typeof setTimeout> | null = null
let backgroundObjectUrl: string | null = null
let backgroundRevision = 0
let customStyleElement: HTMLStyleElement | null = null
let settingsReturnFocus: HTMLElement | null = null

interface DisplayEntry {
  selection: DisplayedFolder
  node: BookmarkNode
}

const entries = computed<DisplayEntry[]>(() => {
  const currentTree = tree.value
  if (!currentTree) return []
  return displayedFolders.value.flatMap((selection) => {
    const node = currentTree.nodes.get(selection.folderId)
    return node?.kind === 'folder' ? [{ selection, node }] : []
  })
})

const activeEntry = computed(() =>
  entries.value.find(({ node }) => node.id === activeEntryId.value),
)

const folderMenuLabel = computed(() => {
  const entry = activeEntry.value
  if (!entry) return '请先选择首页收藏夹'
  return entry.selection.scope === 'direct' ? '此入口仅展示当前层级' : '打开文件夹树'
})

const currentFolder = computed(() => {
  const currentTree = tree.value
  if (!currentTree) return undefined
  const node = currentTree.nodes.get(currentFolderId.value)
  return node?.kind === 'folder' ? node : undefined
})

const breadcrumbs = computed(() => {
  const currentTree = tree.value
  const entry = activeEntry.value
  if (!currentTree || !entry || !currentFolder.value) return []
  const path = getBookmarkPath(currentTree, currentFolder.value.id)
  const rootIndex = path.findIndex(({ id }) => id === entry.node.id)
  return rootIndex >= 0 ? path.slice(rootIndex) : [entry.node]
})

const currentNodes = computed<BookmarkNode[]>(() => {
  const currentTree = tree.value
  const folder = currentFolder.value
  const entry = activeEntry.value
  if (!currentTree || !folder || !entry) return []
  return folder.childIds
    .map((id) => currentTree.nodes.get(id))
    .filter((node): node is BookmarkNode => {
      if (!node || node.kind === 'separator') return false
      return entry.selection.scope === 'subtree' || node.kind === 'bookmark'
    })
    .sort((left, right) => left.index - right.index)
})

const visibleNodes = computed(() => currentNodes.value.slice(0, visibleLimit.value))
const remainingNodeCount = computed(() =>
  Math.max(0, currentNodes.value.length - visibleLimit.value),
)
const currentBookmarkCount = computed(
  () => currentNodes.value.filter(({ kind }) => kind === 'bookmark').length,
)
const currentFolderCount = computed(
  () => currentNodes.value.filter(({ kind }) => kind === 'folder').length,
)
const canWriteCurrentFolder = computed(() => {
  const folder = currentFolder.value
  return Boolean(folder?.childrenWritable)
})

const folderSections = computed<FolderSection[]>(() => {
  const currentTree = tree.value
  const entry = activeEntry.value
  const folder = currentFolder.value
  if (!currentTree || !entry || !folder) return []
  return buildFolderSections(currentTree, folder.id, entry.selection.scope, expandedFolderIds.value)
})

const hasFolderSectionContent = computed(() =>
  folderSections.value.some((section) => section.depth > 0 || section.directBookmarkIds.length > 0),
)

const displayedBookmarkIds = computed(() => {
  const currentTree = tree.value
  return currentTree
    ? resolveDisplayedBookmarkIds(currentTree, displayedFolders.value)
    : new Set<string>()
})

const searchResults = computed(() => {
  const currentTree = tree.value
  if (!currentTree || !searchQuery.value.trim()) return []
  return searchBookmarks(currentTree, searchQuery.value, {
    allowedIds: displayedBookmarkIds.value,
    limit: 30,
  })
})

const searchPanelVisible = computed(
  () => searchFocused.value && !searchEngineMenuOpen.value && searchQuery.value.trim().length > 0,
)

function searchEngineLabel(engine: SearchEngineId): string {
  if (engine === 'custom') return settings.value.search.customName.trim() || '自定义搜索'
  return STANDARD_SEARCH_ENGINES.find(({ id }) => id === engine)?.label ?? 'Google'
}

const searchEngineName = computed(() => {
  return searchEngineLabel(settings.value.search.engine)
})

const availableSearchEngines = computed<Array<{ id: SearchEngineId; label: string }>>(() => {
  const engines: Array<{ id: SearchEngineId; label: string }> = [...STANDARD_SEARCH_ENGINES]
  if (normalizeCustomSearchTemplate(settings.value.search.customUrlTemplate)) {
    engines.push({ id: 'custom', label: searchEngineLabel('custom') })
  }
  return engines
})

const bookmarkTarget = computed(() =>
  settings.value.search.openMode === 'new' ? '_blank' : '_self',
)

const contentTextTone = computed<'dark' | 'light'>(() => {
  const contentAlpha = settings.value.appearance.contentOpacity / 100

  if (contentAlpha >= 0.55) return 'dark'
  return settings.value.appearance.brightness < 95 ? 'light' : 'dark'
})

const bookmarkTextTone = computed<'dark' | 'light'>(() => {
  const contentAlpha = settings.value.appearance.contentOpacity / 100
  const bookmarkAlpha = settings.value.appearance.bookmarkCardOpacity / 100
  const effectiveSurfaceAlpha = 1 - (1 - contentAlpha) * (1 - bookmarkAlpha)

  if (effectiveSurfaceAlpha >= 0.55) return 'dark'
  return settings.value.appearance.brightness < 95 ? 'light' : 'dark'
})

const appearanceVariables = computed(() => ({
  '--jtab-setting-accent': settings.value.appearance.accent,
  '--jtab-setting-background-overlay': `${settings.value.appearance.overlay / 100}`,
  '--jtab-setting-content-opacity': `${settings.value.appearance.contentOpacity / 100}`,
  '--jtab-setting-content-blur': `${settings.value.appearance.contentBlur}px`,
  '--jtab-setting-bookmark-card-opacity': `${settings.value.appearance.bookmarkCardOpacity / 100}`,
  '--jtab-setting-bookmark-detail-card-radius': `${settings.value.appearance.bookmarkDetailCardRadius}px`,
  '--jtab-setting-bookmark-icon-card-radius': `${settings.value.appearance.bookmarkIconCardRadius}%`,
  '--jtab-setting-bookmark-icon-radius': '18%',
}))

const bookmarkIconSize = computed(() =>
  settings.value.appearance.bookmarkLayout === 'icon' ? 50 : 38,
)

const backgroundStyle = computed(() => ({
  filter: `brightness(${settings.value.appearance.brightness}%) blur(${settings.value.appearance.blur}px)`,
  objectPosition: `${settings.value.appearance.focalX}% ${settings.value.appearance.focalY}%`,
  transform: settings.value.appearance.blur > 0 ? 'scale(1.04)' : 'scale(1.01)',
}))

const dialogNode = computed(() => tree.value?.nodes.get(dialogNodeId.value))
const deleteStatistics = computed(() => {
  const currentTree = tree.value
  const node = dialogNode.value
  if (!currentTree || !node || node.kind !== 'folder') return null
  return {
    descendants: countDescendants(currentTree, node.id),
    bookmarks: countBookmarks(currentTree, node.id),
  }
})

const dialogHeading = computed(() => {
  if (dialogMode.value === 'create-folder') return '新建文件夹'
  if (dialogMode.value === 'create-bookmark') return '添加书签'
  if (dialogMode.value === 'rename') return '重命名'
  if (dialogMode.value === 'move') return '移动到'
  if (dialogMode.value === 'delete') return '确认删除'
  return ''
})

const moveTargets = computed(() => {
  const currentTree = tree.value
  const node = dialogNode.value
  if (!currentTree || !node) return []
  return [...currentTree.nodes.values()]
    .filter((candidate) => {
      if (candidate.kind !== 'folder' || !candidate.childrenWritable || candidate.id === node.id) {
        return false
      }
      return node.kind !== 'folder' || !candidate.pathIds.includes(node.id)
    })
    .sort((left, right) =>
      formatBookmarkPath(currentTree, left.id, true).localeCompare(
        formatBookmarkPath(currentTree, right.id, true),
        'zh-CN',
      ),
    )
})

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  if (toastTimer) clearTimeout(toastTimer)
  toast.message = message
  toast.kind = kind
  toast.visible = true
  toastTimer = setTimeout(() => {
    toast.visible = false
  }, 3600)
}

function errorMessage(cause: unknown): string {
  if (cause instanceof BookmarkRepositoryError) {
    const messages: Record<string, string> = {
      bookmark_missing: '书签已不存在，请刷新后重试。',
      destination_missing: '目标文件夹已不存在。',
      destination_not_folder: '选择的目标不是文件夹。',
      root_read_only: '浏览器根目录不能修改。',
      managed_read_only: '此项目由浏览器或组织管理，不能修改。',
      invalid_url: '请输入带协议的完整网址。',
      invalid_index: '书签排序位置无效。',
      invalid_kind: '此类型不支持该操作。',
      descendant_move: '文件夹不能移动到自身或后代目录。',
      folder_not_empty: '非空文件夹需要确认递归删除。',
    }
    return messages[cause.code] ?? cause.message
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function isWithinActiveEntry(folderId: string): boolean {
  const currentTree = tree.value
  const entry = activeEntry.value
  const node = currentTree?.nodes.get(folderId)
  if (!currentTree || !entry || node?.kind !== 'folder') return false
  if (entry.selection.scope === 'direct') return folderId === entry.node.id
  return node.pathIds.includes(entry.node.id)
}

function reconcileNavigation(): void {
  if (entries.value.length === 0) {
    activeEntryId.value = ''
    currentFolderId.value = ''
    return
  }
  if (!entries.value.some(({ node }) => node.id === activeEntryId.value)) {
    activeEntryId.value = entries.value[0]?.node.id ?? ''
  }
  if (!isWithinActiveEntry(currentFolderId.value)) {
    currentFolderId.value = activeEntry.value?.node.id ?? ''
  }
}

function selectEntry(folderId: string): void {
  activeEntryId.value = folderId
  currentFolderId.value = folderId
  visibleLimit.value = 120
  drawerOpen.value = false
  actionMenuId.value = ''
}

function navigateToFolder(folderId: string): void {
  if (!isWithinActiveEntry(folderId)) return
  currentFolderId.value = folderId
  visibleLimit.value = 120
  drawerOpen.value = false
  actionMenuId.value = ''
}

function toggleFolderSection(folderId: string): void {
  const next = new Set(expandedFolderIds.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  expandedFolderIds.value = next
  actionMenuId.value = ''
}

function folderSectionNode(section: FolderSection): BookmarkNode | undefined {
  const node = tree.value?.nodes.get(section.folderId)
  return node?.kind === 'folder' ? node : undefined
}

function visibleSectionBookmarks(section: FolderSection): BookmarkNode[] {
  const currentTree = tree.value
  if (!currentTree) return []
  const limit = folderVisibleLimits[section.folderId] ?? 120
  return section.directBookmarkIds
    .slice(0, limit)
    .map((id) => currentTree.nodes.get(id))
    .filter((node): node is BookmarkNode => node?.kind === 'bookmark')
}

function remainingSectionBookmarks(section: FolderSection): number {
  return Math.max(
    0,
    section.directBookmarkIds.length - (folderVisibleLimits[section.folderId] ?? 120),
  )
}

function showMoreSectionBookmarks(section: FolderSection): void {
  folderVisibleLimits[section.folderId] = (folderVisibleLimits[section.folderId] ?? 120) + 120
}

async function reloadTree(): Promise<void> {
  tree.value = await repository.getTree()
  const removed = await settingsStore.reconcileDisplayedFolders(tree.value)
  reconcileNavigation()
  if (removed.length > 0) {
    showToast(`已移除 ${removed.length} 个不存在的首页入口`, 'error')
  }
}

function searchTemplate(): string | null {
  const search = settings.value.search
  if (search.engine === 'custom') {
    return normalizeCustomSearchTemplate(search.customUrlTemplate)
  }
  return SEARCH_ENGINES[search.engine]
}

function openUrl(url: string, forceNewTab = false): void {
  if (forceNewTab || settings.value.search.openMode === 'new') {
    window.open(url, '_blank', 'noopener')
    return
  }
  location.assign(url)
}

function executeWebSearch(forceNewTab = false): void {
  const query = searchQuery.value.trim()
  if (!query) return
  const template = searchTemplate()
  if (!template) {
    showToast('自定义搜索地址无效，请在设置中重新配置。', 'error')
    return
  }
  openUrl(template.replace('%s', encodeURIComponent(query)), forceNewTab)
}

function onWebSearchClick(event: MouseEvent): void {
  executeWebSearch(event.ctrlKey || event.metaKey)
}

function onWebSearchAuxClick(event: MouseEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  executeWebSearch(true)
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeSearchIndex.value = Math.min(activeSearchIndex.value + 1, searchResults.value.length - 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeSearchIndex.value = Math.max(-1, activeSearchIndex.value - 1)
    return
  }
  if (event.key === 'Escape') {
    searchEngineMenuOpen.value = false
    searchFocused.value = false
    searchInput.value?.blur()
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  const selected = searchResults.value[activeSearchIndex.value]
  if (selected?.node.url) {
    openUrl(selected.node.url, event.ctrlKey || event.metaKey)
    return
  }
  executeWebSearch(event.ctrlKey || event.metaKey)
}

function onSearchBlur(): void {
  if (searchBlurTimer) clearTimeout(searchBlurTimer)
  searchBlurTimer = setTimeout(() => {
    searchBlurTimer = null
    searchFocused.value = false
  }, 120)
}

function onSearchFocus(): void {
  if (searchBlurTimer) {
    clearTimeout(searchBlurTimer)
    searchBlurTimer = null
  }
  searchFocused.value = true
}

function searchEngineMenuButtons(): HTMLButtonElement[] {
  return Array.from(
    searchWrap.value?.querySelectorAll<HTMLButtonElement>(
      '[data-jtab-role="search-engine-option"]',
    ) ?? [],
  )
}

function focusSearchEngineOption(index: number): void {
  const buttons = searchEngineMenuButtons()
  if (buttons.length === 0) return
  buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus()
}

function toggleSearchEngineMenu(): void {
  const opening = !searchEngineMenuOpen.value
  searchEngineMenuOpen.value = opening
  searchFocused.value = false
  actionMenuId.value = ''
  if (!opening) return
  void nextTick(() => {
    const selectedIndex = availableSearchEngines.value.findIndex(
      ({ id }) => id === settings.value.search.engine,
    )
    focusSearchEngineOption(Math.max(0, selectedIndex))
  })
}

function onSearchEngineMenuKeydown(event: KeyboardEvent): void {
  const buttons = searchEngineMenuButtons()
  const currentIndex = buttons.findIndex((button) => button === document.activeElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    searchEngineMenuOpen.value = false
    searchEngineButton.value?.focus()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || buttons.length === 0) {
    return
  }
  event.preventDefault()
  if (event.key === 'Home') focusSearchEngineOption(0)
  else if (event.key === 'End') focusSearchEngineOption(buttons.length - 1)
  else if (event.key === 'ArrowDown') focusSearchEngineOption((currentIndex + 1) % buttons.length)
  else focusSearchEngineOption((currentIndex - 1 + buttons.length) % buttons.length)
}

async function selectSearchEngine(engine: SearchEngineId): Promise<void> {
  searchEngineMenuOpen.value = false
  if (engine === settings.value.search.engine) {
    searchInput.value?.focus()
    return
  }
  try {
    await settingsStore.setSearch({ ...settings.value.search, engine })
    await nextTick()
    searchInput.value?.focus()
  } catch (cause) {
    showToast(errorMessage(cause), 'error')
  }
}

function toggleManageMode(): void {
  manageMode.value = !manageMode.value
  actionMenuId.value = ''
  drawerOpen.value = false
}

function toggleActionMenu(nodeId: string): void {
  actionMenuId.value = actionMenuId.value === nodeId ? '' : nodeId
}

function openCreateDialog(kind: 'folder' | 'bookmark'): void {
  if (!canWriteCurrentFolder.value) return
  dialogMode.value = kind === 'folder' ? 'create-folder' : 'create-bookmark'
  dialogNodeId.value = ''
  dialogTitle.value = ''
  dialogUrl.value = ''
  actionMenuId.value = ''
  void nextTick(() => dialogFirstInput.value?.focus())
}

function openNodeDialog(
  mode: Exclude<DialogMode, 'create-folder' | 'create-bookmark' | null>,
  node: BookmarkNode,
): void {
  if (!node.selfModifiable || node.parentId === null) return
  dialogMode.value = mode
  dialogNodeId.value = node.id
  dialogTitle.value = node.title
  dialogUrl.value = node.url ?? ''
  moveTargetId.value = node.parentId
  actionMenuId.value = ''
  void nextTick(() => dialogFirstInput.value?.focus())
}

function closeDialog(): void {
  if (submitting.value) return
  dialogMode.value = null
  dialogNodeId.value = ''
}

async function submitDialog(): Promise<void> {
  const mode = dialogMode.value
  const folder = currentFolder.value
  if (!mode || !folder) return
  submitting.value = true
  try {
    if (mode === 'create-folder') {
      if (!dialogTitle.value.trim()) throw new Error('请输入文件夹名称。')
      await repository.create({ parentId: folder.id, title: dialogTitle.value.trim() })
      showToast('文件夹已创建')
    } else if (mode === 'create-bookmark') {
      if (!dialogTitle.value.trim()) throw new Error('请输入书签名称。')
      await repository.create({
        parentId: folder.id,
        title: dialogTitle.value.trim(),
        url: dialogUrl.value,
      })
      showToast('书签已添加')
    } else if (mode === 'rename') {
      const node = dialogNode.value
      if (!node || !dialogTitle.value.trim()) throw new Error('请输入名称。')
      await repository.update(node.id, { title: dialogTitle.value.trim() })
      showToast('名称已更新')
    } else if (mode === 'move') {
      const node = dialogNode.value
      if (!node || !moveTargetId.value) throw new Error('请选择目标文件夹。')
      await repository.move(node.id, { parentId: moveTargetId.value })
      showToast('项目已移动')
    } else if (mode === 'delete') {
      const node = dialogNode.value
      if (!node) throw new Error('项目已不存在。')
      await repository.remove(node.id, node.kind === 'folder')
      if (node.kind === 'bookmark') await localAssetRepository.deleteBookmarkIcon(node.id)
      showToast(node.kind === 'folder' ? '文件夹及其内容已删除' : '书签已删除')
    }
    await reloadTree()
    dialogMode.value = null
    dialogNodeId.value = ''
  } catch (cause) {
    showToast(errorMessage(cause), 'error')
  } finally {
    submitting.value = false
  }
}

function requestLocalIcon(node: BookmarkNode): void {
  if (node.kind !== 'bookmark') return
  iconBookmarkId.value = node.id
  actionMenuId.value = ''
  iconInput.value?.click()
}

async function handleIconFile(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  const bookmarkId = iconBookmarkId.value
  input.value = ''
  if (!file || !bookmarkId) return
  try {
    await localAssetRepository.saveBookmarkIcon(bookmarkId, file)
    iconRevision[bookmarkId] = (iconRevision[bookmarkId] ?? 0) + 1
    showToast('本地图标已保存')
  } catch (cause) {
    showToast(errorMessage(cause), 'error')
  }
}

async function resetLocalIcon(node: BookmarkNode): Promise<void> {
  actionMenuId.value = ''
  try {
    await localAssetRepository.deleteBookmarkIcon(node.id)
    iconRevision[node.id] = (iconRevision[node.id] ?? 0) + 1
    showToast(IS_FIREFOX ? '已恢复文字字标' : '已恢复浏览器缓存图标')
  } catch (cause) {
    showToast(errorMessage(cause), 'error')
  }
}

function translatedIconSource(source: BookmarkIconSource | undefined): string {
  if (source === 'local') return '本地自定义'
  if (source === 'browser') return '浏览器缓存'
  return '文字兜底'
}

function destinationIndexAfterSort(nodeId: string, oldIndex: number, newIndex: number): number {
  const parent = currentFolder.value
  if (!parent) return newIndex
  const reordered = [...currentNodes.value]
  const [moved] = reordered.splice(oldIndex, 1)
  if (!moved || moved.id !== nodeId) return newIndex
  reordered.splice(newIndex, 0, moved)
  const following = reordered[newIndex + 1]
  if (!following) return parent.childIds.length - 1
  const original = tree.value?.nodes.get(nodeId)
  return Math.max(0, following.index - (original && original.index < following.index ? 1 : 0))
}

function setupSortable(): void {
  sortable?.destroy()
  sortable = null
  if (!manageMode.value || !contentGrid.value) return
  sortable = Sortable.create(contentGrid.value, {
    animation: 180,
    handle: '[data-jtab-role="drag-handle"]',
    draggable: '[data-jtab-component="content-tile"]',
    dataIdAttr: 'data-node-id',
    ghostClass: 'content-tile--ghost',
    chosenClass: 'content-tile--chosen',
    onEnd: (event) => {
      const nodeId = event.item.dataset.nodeId
      const oldIndex = event.oldIndex
      const newIndex = event.newIndex
      const parent = currentFolder.value
      if (!nodeId || oldIndex === undefined || newIndex === undefined || !parent) return
      const index = destinationIndexAfterSort(nodeId, oldIndex, newIndex)
      void repository
        .move(nodeId, { parentId: parent.id, index })
        .then(reloadTree)
        .catch((cause: unknown) => {
          showToast(errorMessage(cause), 'error')
          sortable?.sort(currentNodes.value.map(({ id }) => id))
        })
    },
  })
}

function openSettings(): void {
  if (submitting.value || settingsOpen.value) return
  settingsReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  closeDialog()
  settingsOpen.value = true
  drawerOpen.value = false
  searchEngineMenuOpen.value = false
  actionMenuId.value = ''
  void nextTick(() => settingsCloseButton.value?.focus())
}

function closeSettings(): void {
  if (!settingsOpen.value) return
  settingsOpen.value = false
  const returnTarget = settingsReturnFocus
  settingsReturnFocus = null
  void nextTick(() => {
    if (returnTarget?.isConnected) returnTarget.focus()
    else settingsButton.value?.focus()
  })
}

function isCloseSettingsMessage(value: unknown): value is { type: 'jtab:close-settings' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'jtab:close-settings'
  )
}

function onWindowMessage(event: MessageEvent<unknown>): void {
  if (
    event.origin !== location.origin ||
    event.source !== settingsFrame.value?.contentWindow ||
    !isCloseSettingsMessage(event.data)
  ) {
    return
  }
  closeSettings()
}

async function updateBackground(): Promise<void> {
  const revision = ++backgroundRevision
  if (backgroundObjectUrl) {
    URL.revokeObjectURL(backgroundObjectUrl)
    backgroundObjectUrl = null
  }
  backgroundFallback.value = false
  const background = settings.value.appearance.background
  if (background.kind === 'bundled') {
    backgroundUrl.value = background.src
    return
  }
  if (background.kind === 'remote') {
    backgroundUrl.value = background.url
    return
  }
  const asset = await localAssetRepository.getBackground(background.assetId)
  if (revision !== backgroundRevision) return
  if (!asset) {
    backgroundFallback.value = true
    backgroundUrl.value = DEFAULT_BACKGROUND_SRC
    showToast('本地背景已不存在，当前使用默认背景。', 'error')
    return
  }
  backgroundObjectUrl = URL.createObjectURL(asset.blob)
  backgroundUrl.value = backgroundObjectUrl
}

function handleBackgroundError(): void {
  if (backgroundFallback.value) return
  backgroundFallback.value = true
  backgroundUrl.value = DEFAULT_BACKGROUND_SRC
  showToast('背景加载失败，当前使用默认背景。', 'error')
}

function updateCustomCss(): void {
  customStyleElement?.remove()
  customStyleElement = null
  const customCss = settings.value.customCss
  if (!customCss.enabled || !customCss.code.trim()) return
  if (!passesCustomCssPrivacyBoundary(customCss.code)) {
    showToast('自定义 CSS 隐私校验失败，已暂时停用。', 'error')
    return
  }
  customStyleElement = document.createElement('style')
  customStyleElement.id = 'jtab-user-css'
  customStyleElement.dataset.jtabComponent = 'user-css'
  customStyleElement.textContent = `@layer user {\n${customCss.code}\n}`
  document.head.append(customStyleElement)
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (settingsOpen.value) closeSettings()
  else if (dialogMode.value) closeDialog()
  else if (drawerOpen.value) drawerOpen.value = false
  else if (searchEngineMenuOpen.value) searchEngineMenuOpen.value = false
  else actionMenuId.value = ''
}

function onDocumentPointerDown(event: Event): void {
  const target = event.target
  if (
    !searchEngineMenuOpen.value ||
    !(target instanceof Node) ||
    searchWrap.value?.contains(target)
  ) {
    return
  }
  searchEngineMenuOpen.value = false
}

function onDocumentFocusIn(event: Event): void {
  const target = event.target
  if (searchEngineMenuOpen.value && target instanceof Node && !searchWrap.value?.contains(target)) {
    searchEngineMenuOpen.value = false
  }
}

function reloadPage(): void {
  location.reload()
}

watch(searchQuery, () => {
  activeSearchIndex.value = -1
})

watch(settingsOpen, (open) => {
  document.body.classList.toggle('jtab-settings-open', open)
})

watch(
  () => [
    settings.value.appearance.background,
    settings.value.appearance.focalX,
    settings.value.appearance.focalY,
  ],
  () => void updateBackground(),
  { deep: true },
)

watch(() => settings.value.customCss, updateCustomCss, { deep: true })

watch(settingsError, (message) => {
  if (message) showToast(message, 'error')
})

watch(
  () => [manageMode.value, currentFolderId.value, tree.value?.revision, visibleLimit.value],
  () => void nextTick(setupSortable),
)

onMounted(async () => {
  document.addEventListener('keydown', onDocumentKeydown)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('focusin', onDocumentFocusIn)
  window.addEventListener('message', onWindowMessage)
  try {
    await settingsStore.initialize()
    tree.value = await repository.getTree()
    await settingsStore.reconcileDisplayedFolders(tree.value)
    reconcileNavigation()
    unsubscribeBookmarks = repository.subscribe(
      () => void reloadTree(),
      (error) => showToast(errorMessage(error), 'error'),
    )
    await updateBackground()
    updateCustomCss()
  } catch (cause) {
    fatalError.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  unsubscribeBookmarks?.()
  sortable?.destroy()
  customStyleElement?.remove()
  document.body.classList.remove('jtab-settings-open')
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('focusin', onDocumentFocusIn)
  window.removeEventListener('message', onWindowMessage)
  if (toastTimer) clearTimeout(toastTimer)
  if (searchBlurTimer) clearTimeout(searchBlurTimer)
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl)
  settingsStore.dispose()
})
</script>

<template>
  <div
    class="jtab-shell"
    :class="`bookmark-layout--${settings.appearance.bookmarkLayout}`"
    data-jtab-component="new-tab"
    :data-jtab-content-tone="contentTextTone"
    :style="appearanceVariables"
    @click.self="actionMenuId = ''"
  >
    <img
      class="fluid-background"
      data-jtab-role="background"
      :src="backgroundUrl"
      alt=""
      :style="backgroundStyle"
      referrerpolicy="no-referrer"
      @error="handleBackgroundError"
    />
    <div class="fluid-overlay" aria-hidden="true" />

    <header
      class="topbar"
      data-jtab-component="topbar"
      :inert="settingsOpen ? true : undefined"
      :aria-hidden="settingsOpen ? 'true' : undefined"
    >
      <div class="topbar__brand">
        <div class="brand" aria-label="JTab">
          <img
            class="brand__logo"
            data-jtab-role="brand-logo"
            src="/icons/icon.svg"
            alt=""
            aria-hidden="true"
          />
          <span>JTab</span>
        </div>
        <button
          type="button"
          class="icon-button folder-menu-button"
          data-jtab-role="folder-menu"
          :disabled="!activeEntry || activeEntry.selection.scope === 'direct'"
          :title="folderMenuLabel"
          :aria-label="folderMenuLabel"
          :aria-expanded="drawerOpen"
          aria-controls="jtab-folder-drawer"
          @click="drawerOpen = true"
        >
          <Menu :size="19" aria-hidden="true" />
        </button>
      </div>

      <div ref="searchWrap" class="search-wrap" data-jtab-component="search">
        <div class="search-box" role="search">
          <Search :size="20" aria-hidden="true" />
          <label class="sr-only" for="jtab-search-input">搜索已展示的书签或使用搜索引擎</label>
          <input
            id="jtab-search-input"
            ref="searchInput"
            v-model="searchQuery"
            type="search"
            aria-label="搜索已展示的书签或使用搜索引擎"
            autocomplete="off"
            spellcheck="false"
            :placeholder="`搜索书签，或使用 ${searchEngineName}`"
            :aria-expanded="searchPanelVisible"
            aria-controls="jtab-search-results"
            :aria-activedescendant="
              activeSearchIndex >= 0 ? `jtab-search-result-${activeSearchIndex}` : undefined
            "
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown="onSearchKeydown"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="icon-button icon-button--quiet"
            title="清空搜索"
            @mousedown.prevent
            @click="searchQuery = ''"
          >
            <X :size="17" aria-hidden="true" />
          </button>
          <button
            ref="searchEngineButton"
            type="button"
            class="search-engine-button"
            :class="{ 'search-engine-button--active': searchEngineMenuOpen }"
            :aria-expanded="searchEngineMenuOpen"
            :aria-label="`当前搜索引擎：${searchEngineName}，点击切换`"
            aria-haspopup="menu"
            @mousedown.prevent
            @click="toggleSearchEngineMenu"
          >
            <span>{{ searchEngineName }}</span>
            <ChevronDown :size="15" aria-hidden="true" />
          </button>
        </div>

        <div
          v-if="searchEngineMenuOpen"
          class="search-engine-menu"
          data-jtab-component="search-engine-menu"
          role="menu"
          @keydown="onSearchEngineMenuKeydown"
        >
          <span class="search-engine-menu__label">选择搜索引擎</span>
          <button
            v-for="engine in availableSearchEngines"
            :key="engine.id"
            type="button"
            data-jtab-role="search-engine-option"
            role="menuitemradio"
            :aria-checked="settings.search.engine === engine.id"
            :class="{ 'is-active': settings.search.engine === engine.id }"
            @mousedown.prevent
            @click="selectSearchEngine(engine.id)"
          >
            <Search :size="16" aria-hidden="true" />
            <span>{{ engine.label }}</span>
            <Check v-if="settings.search.engine === engine.id" :size="16" aria-hidden="true" />
          </button>
        </div>

        <div
          v-if="searchPanelVisible"
          id="jtab-search-results"
          class="search-results"
          data-jtab-component="search-results"
          role="listbox"
        >
          <a
            v-for="(result, index) in searchResults"
            :id="`jtab-search-result-${index}`"
            :key="result.node.id"
            class="search-result"
            :class="{ 'search-result--active': index === activeSearchIndex }"
            :href="result.node.url ?? '#'"
            :target="bookmarkTarget"
            :aria-selected="index === activeSearchIndex"
            role="option"
            rel="noopener"
            @mouseenter="activeSearchIndex = index"
            @click="searchFocused = false"
          >
            <BookmarkIcon
              :key="`${result.node.id}:${iconRevision[result.node.id] ?? 0}`"
              :bookmark-id="result.node.id"
              :title="result.node.title"
              :url="result.node.url ?? ''"
              :size="32"
            />
            <span>
              <strong>{{ result.node.title || getBookmarkHostname(result.node.url ?? '') }}</strong>
              <small
                >{{ result.hostname
                }}<template v-if="result.path"> · {{ result.path }}</template></small
              >
            </span>
            <ExternalLink :size="15" aria-hidden="true" />
          </a>
          <button
            type="button"
            class="web-search-result"
            :class="{ 'web-search-result--only': searchResults.length === 0 }"
            @mousedown.prevent
            @click="onWebSearchClick"
            @auxclick="onWebSearchAuxClick"
          >
            <Search :size="17" aria-hidden="true" />
            <span>使用 {{ searchEngineName }} 搜索“{{ searchQuery.trim() }}”</span>
            <ChevronRight :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="topbar__actions">
        <button
          type="button"
          class="command-button"
          :class="{ 'command-button--active': manageMode }"
          :aria-pressed="manageMode"
          title="管理书签"
          @click="toggleManageMode"
        >
          <Check v-if="manageMode" :size="18" aria-hidden="true" />
          <Pencil v-else :size="18" aria-hidden="true" />
          <span>{{ manageMode ? '完成' : '管理' }}</span>
        </button>
        <button
          ref="settingsButton"
          type="button"
          class="icon-button"
          title="打开设置"
          @click="openSettings"
        >
          <Settings :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main
      class="workspace"
      data-jtab-role="workspace"
      :inert="settingsOpen ? true : undefined"
      :aria-hidden="settingsOpen ? 'true' : undefined"
    >
      <section v-if="loading" class="state-panel" aria-live="polite">
        <span class="loading-ring" aria-hidden="true" />
        <strong>正在读取浏览器书签</strong>
      </section>

      <section v-else-if="fatalError" class="state-panel state-panel--error">
        <CircleAlert :size="28" aria-hidden="true" />
        <strong>无法加载 JTab</strong>
        <p>{{ fatalError }}</p>
        <button type="button" class="primary-button" @click="reloadPage">重新加载</button>
      </section>

      <section v-else-if="entries.length === 0" class="state-panel state-panel--setup">
        <span class="state-panel__icon" data-jtab-role="folder-icon">
          <FolderPlus :size="28" aria-hidden="true" />
        </span>
        <strong>选择要放在首页的收藏夹</strong>
        <p>浏览器书签仍是唯一数据源，首页不会自动展示未选择的目录。</p>
        <button type="button" class="primary-button" @click="openSettings">
          <Settings :size="18" aria-hidden="true" />
          打开设置
        </button>
      </section>

      <template v-else>
        <nav class="entry-tabs" data-jtab-component="folder-tabs" aria-label="首页收藏夹入口">
          <button
            v-for="entry in entries"
            :key="entry.node.id"
            type="button"
            :class="{ 'entry-tab--active': entry.node.id === activeEntryId }"
            :aria-current="entry.node.id === activeEntryId ? 'page' : undefined"
            @click="selectEntry(entry.node.id)"
          >
            <span class="folder-symbol folder-symbol--tab" data-jtab-role="folder-icon">
              <FolderOpen v-if="entry.node.id === activeEntryId" :size="17" aria-hidden="true" />
              <Folder v-else :size="17" aria-hidden="true" />
            </span>
            <span>{{ entry.node.title || '未命名文件夹' }}</span>
            <small>{{
              countBookmarks(tree!, entry.node.id, entry.selection.scope === 'subtree')
            }}</small>
          </button>
        </nav>

        <section
          class="content-section"
          :class="`content-section--${settings.appearance.bookmarkLayout}`"
          data-jtab-component="bookmark-browser"
          :data-jtab-content-tone="contentTextTone"
          :data-jtab-bookmark-tone="bookmarkTextTone"
          :data-jtab-content-transparent="settings.appearance.contentOpacity === 0"
          :data-jtab-content-blur="settings.appearance.contentBlur > 0"
          :data-jtab-bookmark-transparent="settings.appearance.bookmarkCardOpacity === 0"
        >
          <div class="content-heading">
            <div class="content-heading__main">
              <div>
                <nav class="breadcrumbs" aria-label="当前位置">
                  <template v-for="(crumb, index) in breadcrumbs" :key="crumb.id">
                    <ChevronRight v-if="index > 0" :size="14" aria-hidden="true" />
                    <button
                      type="button"
                      :aria-current="crumb.id === currentFolderId ? 'page' : undefined"
                      @click="navigateToFolder(crumb.id)"
                    >
                      {{ crumb.title || '未命名文件夹' }}
                    </button>
                  </template>
                </nav>
                <h1>{{ currentFolder?.title || '未命名文件夹' }}</h1>
                <p>
                  <span v-if="activeEntry?.selection.scope === 'direct'">仅当前层级</span>
                  <span v-else>{{ currentFolderCount }} 个文件夹</span>
                  <span> · {{ currentBookmarkCount }} 个书签</span>
                </p>
              </div>
            </div>

            <div
              v-if="manageMode"
              class="management-actions"
              data-jtab-component="management-toolbar"
            >
              <span v-if="!canWriteCurrentFolder" class="managed-note">
                <ShieldCheck :size="16" aria-hidden="true" />只读目录
              </span>
              <button
                v-if="activeEntry?.selection.scope === 'subtree'"
                type="button"
                class="secondary-button"
                :disabled="!canWriteCurrentFolder"
                @click="openCreateDialog('folder')"
              >
                <FolderPlus :size="17" aria-hidden="true" />新建文件夹
              </button>
              <button
                type="button"
                class="primary-button"
                :disabled="!canWriteCurrentFolder"
                @click="openCreateDialog('bookmark')"
              >
                <BookmarkPlus :size="17" aria-hidden="true" />添加书签
              </button>
            </div>
          </div>

          <div
            v-if="!manageMode && hasFolderSectionContent"
            class="folder-sections"
            data-jtab-component="recursive-bookmark-folders"
          >
            <section
              v-for="section in folderSections"
              :key="section.folderId"
              class="folder-section"
              :class="{ 'folder-section--root': section.depth === 0 }"
              :style="{ '--folder-depth': section.depth }"
              data-jtab-component="bookmark-folder-section"
              :data-folder-id="section.folderId"
            >
              <header v-if="section.depth > 0" class="folder-section__heading">
                <button
                  type="button"
                  class="folder-section__toggle"
                  :aria-expanded="section.isExpanded"
                  :aria-controls="`jtab-folder-content-${section.folderId}`"
                  @click="toggleFolderSection(section.folderId)"
                >
                  <ChevronDown v-if="section.isExpanded" :size="18" aria-hidden="true" />
                  <ChevronRight v-else :size="18" aria-hidden="true" />
                  <span class="folder-symbol folder-symbol--compact" data-jtab-role="folder-icon">
                    <FolderOpen v-if="section.isExpanded" :size="19" aria-hidden="true" />
                    <Folder v-else :size="19" aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{{ folderSectionNode(section)?.title || '未命名文件夹' }}</strong>
                    <small>
                      {{ section.directBookmarkIds.length }} 个直属书签 ·
                      {{ section.childFolderIds.length }} 个子文件夹
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  class="icon-button folder-section__enter"
                  :title="`单独查看并管理：${folderSectionNode(section)?.title || '未命名文件夹'}`"
                  :aria-label="`单独查看并管理：${folderSectionNode(section)?.title || '未命名文件夹'}`"
                  @click="navigateToFolder(section.folderId)"
                >
                  <FolderOpen :size="18" aria-hidden="true" />
                </button>
              </header>

              <div
                v-if="section.isExpanded"
                :id="`jtab-folder-content-${section.folderId}`"
                class="folder-section__content"
              >
                <div
                  v-if="section.directBookmarkIds.length > 0"
                  class="content-grid bookmark-grid"
                  data-jtab-role="bookmark-grid"
                >
                  <article
                    v-for="node in visibleSectionBookmarks(section)"
                    :key="node.id"
                    class="content-tile content-tile--bookmark"
                    data-jtab-component="content-tile"
                    data-jtab-role="bookmark-card"
                    :data-node-id="node.id"
                  >
                    <a
                      class="tile-link tile-link--bookmark"
                      :href="node.url ?? '#'"
                      :target="bookmarkTarget"
                      rel="noopener"
                    >
                      <BookmarkIcon
                        :key="`${node.id}:${iconRevision[node.id] ?? 0}`"
                        :bookmark-id="node.id"
                        :title="node.title"
                        :url="node.url ?? ''"
                        :size="bookmarkIconSize"
                        @source-change="iconSources[node.id] = $event"
                      />
                      <span class="tile-copy">
                        <strong>{{ node.title || getBookmarkHostname(node.url ?? '') }}</strong>
                        <small>{{ getBookmarkHostname(node.url ?? '') }}</small>
                      </span>
                      <ExternalLink :size="15" aria-hidden="true" />
                    </a>
                  </article>
                </div>

                <p
                  v-else-if="section.childFolderIds.length === 0 && section.depth > 0"
                  class="folder-section__empty"
                >
                  此文件夹没有直属书签
                </p>

                <button
                  v-if="remainingSectionBookmarks(section) > 0"
                  type="button"
                  class="load-more load-more--section"
                  @click="showMoreSectionBookmarks(section)"
                >
                  再显示 {{ Math.min(120, remainingSectionBookmarks(section)) }} 项
                  <ChevronDown :size="17" aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>

          <div
            v-else-if="manageMode && visibleNodes.length > 0"
            ref="contentGrid"
            class="content-grid"
            :class="{ 'content-grid--managing': manageMode }"
            data-jtab-role="content-grid"
            @click.self="actionMenuId = ''"
          >
            <article
              v-for="node in visibleNodes"
              :key="node.id"
              class="content-tile"
              :class="[
                `content-tile--${node.kind}`,
                { 'content-tile--readonly': !node.selfModifiable },
              ]"
              data-jtab-component="content-tile"
              :data-jtab-role="node.kind === 'bookmark' ? 'bookmark-card' : undefined"
              :data-node-id="node.id"
            >
              <button
                v-if="manageMode"
                type="button"
                class="drag-handle"
                data-jtab-role="drag-handle"
                :disabled="!node.selfModifiable"
                :title="`拖拽排序：${node.title || '未命名项目'}`"
                :aria-label="`拖拽排序：${node.title || '未命名项目'}`"
              >
                <GripVertical :size="17" aria-hidden="true" />
              </button>

              <button
                v-if="node.kind === 'folder'"
                type="button"
                class="tile-link tile-link--folder"
                @click="navigateToFolder(node.id)"
              >
                <span class="folder-symbol" data-jtab-role="folder-icon">
                  <Folder :size="25" aria-hidden="true" />
                </span>
                <span class="tile-copy">
                  <strong>{{ node.title || '未命名文件夹' }}</strong>
                  <small>{{ countBookmarks(tree!, node.id) }} 个书签</small>
                </span>
                <ChevronRight :size="17" aria-hidden="true" />
              </button>

              <a
                v-else
                class="tile-link tile-link--bookmark"
                :href="node.url ?? '#'"
                :target="bookmarkTarget"
                rel="noopener"
              >
                <BookmarkIcon
                  :key="`${node.id}:${iconRevision[node.id] ?? 0}`"
                  :bookmark-id="node.id"
                  :title="node.title"
                  :url="node.url ?? ''"
                  :size="bookmarkIconSize"
                  @source-change="iconSources[node.id] = $event"
                />
                <span class="tile-copy">
                  <strong>{{ node.title || getBookmarkHostname(node.url ?? '') }}</strong>
                  <small>{{ getBookmarkHostname(node.url ?? '') }}</small>
                </span>
                <ExternalLink :size="15" aria-hidden="true" />
              </a>

              <div v-if="manageMode" class="tile-actions">
                <button
                  type="button"
                  class="icon-button icon-button--tile"
                  :disabled="!node.selfModifiable"
                  :title="`更多操作：${node.title || '未命名项目'}`"
                  :aria-label="`更多操作：${node.title || '未命名项目'}`"
                  :aria-expanded="actionMenuId === node.id"
                  @click.stop="toggleActionMenu(node.id)"
                >
                  <MoreHorizontal :size="19" aria-hidden="true" />
                </button>

                <div
                  v-if="actionMenuId === node.id"
                  class="action-menu"
                  data-jtab-component="bookmark-actions"
                  role="menu"
                  @click.stop
                >
                  <button type="button" role="menuitem" @click="openNodeDialog('rename', node)">
                    <Pencil :size="16" aria-hidden="true" />重命名
                  </button>
                  <button type="button" role="menuitem" @click="openNodeDialog('move', node)">
                    <Move :size="16" aria-hidden="true" />移动到
                  </button>
                  <template v-if="node.kind === 'bookmark'">
                    <button type="button" role="menuitem" @click="requestLocalIcon(node)">
                      <ImagePlus :size="16" aria-hidden="true" />更换本地图标
                    </button>
                    <button type="button" role="menuitem" @click="resetLocalIcon(node)">
                      <LayoutGrid :size="16" aria-hidden="true" />恢复默认图标
                    </button>
                    <span class="action-menu__source">
                      图标来源：{{ translatedIconSource(iconSources[node.id]) }}
                    </span>
                  </template>
                  <button
                    type="button"
                    class="action-menu__danger"
                    role="menuitem"
                    @click="openNodeDialog('delete', node)"
                  >
                    <Trash2 :size="16" aria-hidden="true" />删除
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="empty-folder">
            <span class="folder-symbol" data-jtab-role="folder-icon">
              <FolderOpen :size="24" aria-hidden="true" />
            </span>
            <strong>这个文件夹还没有可展示的内容</strong>
            <button
              v-if="manageMode && canWriteCurrentFolder"
              type="button"
              class="primary-button"
              @click="openCreateDialog('bookmark')"
            >
              <Plus :size="17" aria-hidden="true" />添加第一个书签
            </button>
          </div>

          <button
            v-if="manageMode && remainingNodeCount > 0"
            type="button"
            class="load-more"
            @click="visibleLimit += 120"
          >
            再显示 {{ Math.min(120, remainingNodeCount) }} 项
            <ChevronDown :size="17" aria-hidden="true" />
          </button>
        </section>
      </template>
    </main>

    <Transition name="settings-panel">
      <div v-if="settingsOpen" class="settings-layer" @click.self="closeSettings">
        <section
          class="settings-panel"
          data-jtab-component="settings-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="jtab-settings-title"
        >
          <header class="settings-panel__header">
            <div>
              <span class="brand__mark"><Settings :size="18" aria-hidden="true" /></span>
              <span>
                <strong id="jtab-settings-title">JTab 设置</strong>
                <small>修改后自动保存到本机</small>
              </span>
            </div>
            <button
              ref="settingsCloseButton"
              type="button"
              class="icon-button"
              title="关闭设置"
              aria-label="关闭设置"
              @click="closeSettings"
            >
              <X :size="20" aria-hidden="true" />
            </button>
          </header>
          <iframe ref="settingsFrame" src="/options.html?embedded=1" title="JTab 设置" />
        </section>
      </div>
    </Transition>

    <div
      v-if="drawerOpen && tree && activeEntry"
      class="drawer-layer"
      @click.self="drawerOpen = false"
    >
      <aside
        id="jtab-folder-drawer"
        class="folder-drawer"
        data-jtab-component="folder-drawer"
        aria-label="文件夹导航"
      >
        <header>
          <div>
            <small>文件夹导航</small>
            <strong>{{ activeEntry.node.title || '未命名文件夹' }}</strong>
          </div>
          <button type="button" class="icon-button" title="关闭" @click="drawerOpen = false">
            <X :size="20" aria-hidden="true" />
          </button>
        </header>
        <FolderTree
          :tree="tree"
          :root-id="activeEntry.node.id"
          :current-id="currentFolderId"
          @select="navigateToFolder"
        />
      </aside>
    </div>

    <div v-if="dialogMode" class="dialog-layer" @mousedown.self="closeDialog">
      <form class="dialog" data-jtab-component="dialog" @submit.prevent="submitDialog">
        <header>
          <h2>{{ dialogHeading }}</h2>
          <button type="button" class="icon-button" title="关闭" @click="closeDialog">
            <X :size="19" aria-hidden="true" />
          </button>
        </header>

        <template
          v-if="
            dialogMode === 'create-folder' ||
            dialogMode === 'create-bookmark' ||
            dialogMode === 'rename'
          "
        >
          <label class="field">
            <span>名称</span>
            <input ref="dialogFirstInput" v-model="dialogTitle" maxlength="255" required />
          </label>
          <label v-if="dialogMode === 'create-bookmark'" class="field">
            <span>网址</span>
            <input
              v-model="dialogUrl"
              type="url"
              maxlength="2048"
              placeholder="https://example.com"
              required
            />
          </label>
        </template>

        <label v-else-if="dialogMode === 'move'" class="field">
          <span>目标文件夹</span>
          <select ref="dialogFirstInput" v-model="moveTargetId" required>
            <option v-for="folder in moveTargets" :key="folder.id" :value="folder.id">
              {{ formatBookmarkPath(tree!, folder.id, true) || '未命名文件夹' }}
            </option>
          </select>
        </label>

        <div v-else-if="dialogMode === 'delete'" class="delete-warning">
          <CircleAlert :size="24" aria-hidden="true" />
          <div>
            <strong>删除“{{ dialogNode?.title || '未命名项目' }}”后无法由 JTab 撤销。</strong>
            <p v-if="deleteStatistics">
              将同时删除 {{ deleteStatistics.descendants }} 个后代项目，其中包含
              {{ deleteStatistics.bookmarks }} 个书签。
            </p>
            <p v-else>该书签将从浏览器收藏夹中删除。</p>
          </div>
        </div>

        <footer>
          <button
            type="button"
            class="secondary-button"
            :disabled="submitting"
            @click="closeDialog"
          >
            取消
          </button>
          <button
            type="submit"
            class="primary-button"
            :class="{ 'primary-button--danger': dialogMode === 'delete' }"
            :disabled="submitting || (dialogMode === 'move' && moveTargets.length === 0)"
          >
            {{ submitting ? '处理中…' : dialogMode === 'delete' ? '确认删除' : '保存' }}
          </button>
        </footer>
      </form>
    </div>

    <input
      ref="iconInput"
      class="visually-hidden-input"
      type="file"
      tabindex="-1"
      accept="image/jpeg,image/png,image/webp"
      @change="handleIconFile"
    />

    <Transition name="toast">
      <div
        v-if="toast.visible"
        class="toast"
        :class="`toast--${toast.kind}`"
        data-jtab-component="toast"
        role="status"
      >
        <Check v-if="toast.kind === 'success'" :size="18" aria-hidden="true" />
        <CircleAlert v-else :size="18" aria-hidden="true" />
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>
