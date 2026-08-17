<script setup lang="ts">
/* global Event, HTMLInputElement, HTMLElement, KeyboardEvent, TextEncoder, URL, clearTimeout, document, location, setTimeout, window */

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  ExternalLink,
  FolderTree,
  GripVertical,
  Image,
  Link,
  List,
  LoaderCircle,
  LayoutGrid,
  Monitor,
  Palette,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from '@lucide/vue'

import FolderPicker from './components/FolderPicker.vue'
import {
  BrowserBookmarkRepository,
  formatBookmarkPath,
  normalizeDisplayedFolders,
} from '../../src/core/bookmarks'
import type {
  AppearanceSettings,
  BookmarkTree,
  DisplayedFolder,
  SearchEngineId,
  SearchSettings,
} from '../../src/core/types'
import { normalizeCustomSearchTemplate } from '../../src/core/search'
import { localAssetRepository, preloadRemoteBackground } from '../../src/services/assets'
import type { CustomCssValidationResult } from '../../src/services/custom-css'
import { useSettingsStore } from '../../src/stores/settings'

type CustomCssValidator = (code: string) => CustomCssValidationResult

const PRESET_BACKGROUNDS = [
  { id: 'quiet-tide', name: '静潮', src: '/wallpapers/quiet-tide.webp', tone: '#335f68' },
  { id: 'verdant-lake', name: '绿湖', src: '/wallpapers/verdant-lake.webp', tone: '#3d6752' },
  { id: 'coral-ridge', name: '珊瑚岭', src: '/wallpapers/coral-ridge.webp', tone: '#a8644a' },
] as const

const SEARCH_ENGINES: Array<{ id: SearchEngineId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'bing', label: 'Bing' },
  { id: 'baidu', label: '百度' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
  { id: 'custom', label: '自定义' },
]

const repository = new BrowserBookmarkRepository()
const settingsStore = useSettingsStore()
const {
  displayedFolders,
  error: settingsError,
  initialized,
  saving,
  settings,
} = storeToRefs(settingsStore)
const embeddedMode = new URL(location.href).searchParams.get('embedded') === '1'

const tree = ref<BookmarkTree | null>(null)
const loadingTree = ref(true)
const uploadInput = ref<HTMLInputElement | null>(null)
const entryList = ref<HTMLElement | null>(null)
const remoteUrl = ref('')
const backgroundBusy = ref(false)
const backgroundPreviewUrl = ref('')
const cssDraft = ref('')
const cssEnabled = ref(false)
const cssValidator = shallowRef<CustomCssValidator | null>(null)
const toast = reactive({ visible: false, kind: 'success' as 'success' | 'error', message: '' })
const searchDraft = reactive<SearchSettings>({ ...settings.value.search })
const appearanceDraft = reactive<AppearanceSettings>({
  ...settings.value.appearance,
  background: { ...settings.value.appearance.background },
})

const collectionPreviewUsesLightText = computed(
  () => appearanceDraft.contentOpacity < 55 && appearanceDraft.brightness < 95,
)
const bookmarkPreviewUsesLightText = computed(() => {
  const contentOpacity = appearanceDraft.contentOpacity / 100
  const bookmarkOpacity = appearanceDraft.bookmarkCardOpacity / 100
  const effectiveSurfaceOpacity = 1 - (1 - contentOpacity) * (1 - bookmarkOpacity)
  return effectiveSurfaceOpacity < 0.55 && appearanceDraft.brightness < 95
})

let unsubscribeBookmarks: (() => void) | null = null
let sortable: Sortable | null = null
let previewObjectUrl: string | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let previewRevision = 0

const activeBackgroundKey = computed(() => {
  const background = settings.value.appearance.background
  if (background.kind === 'bundled') return `bundled:${background.id}`
  if (background.kind === 'local') return `local:${background.assetId}`
  return `remote:${background.url}`
})

const cssBytes = computed(() => new TextEncoder().encode(cssDraft.value).byteLength)
const cssValidation = computed<CustomCssValidationResult>(() =>
  cssValidator.value
    ? cssValidator.value(cssDraft.value)
    : {
        valid: false,
        bytes: cssBytes.value,
        issues: [{ code: 'syntax', message: '正在加载 CSS 校验器。' }],
      },
)
const cssPreviewDocument = computed(() => {
  const safeCode = cssValidation.value.valid
    ? cssDraft.value.replace(/<\/style/giu, '<\\/style')
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    :root{--jtab-accent:#44c2a5;--jtab-text:#18201e;--jtab-surface:rgba(255,255,255,.82)}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#dce5e2;color:var(--jtab-text);font:14px "Microsoft YaHei UI",sans-serif}
    [data-jtab-component="bookmark-tile"]{width:270px;padding:18px;border:1px solid rgba(26,53,47,.16);border-radius:8px;background:var(--jtab-surface);box-shadow:0 18px 45px rgba(17,40,35,.13)}
    [data-jtab-role="bookmark-icon"]{display:grid;width:38px;height:38px;place-items:center;margin-bottom:14px;border-radius:8px;background:var(--jtab-accent);color:#092e27;font-weight:800}
    strong{display:block;font-size:16px}p{margin:6px 0 0;color:#52625e}
    ${safeCode}
  </style></head><body><article data-jtab-component="bookmark-tile"><span data-jtab-role="bookmark-icon">J</span><strong>JTab 示例书签</strong><p>example.com · 工作 / 常用</p></article></body></html>`
})

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  if (toastTimer) clearTimeout(toastTimer)
  toast.message = message
  toast.kind = kind
  toast.visible = true
  toastTimer = setTimeout(() => {
    toast.visible = false
  }, 4200)
}

async function runAction(action: () => Promise<void>, successMessage?: string): Promise<void> {
  try {
    await action()
    if (successMessage) showToast(successMessage)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error')
  }
}

function folderLabel(folderId: string): string {
  if (!tree.value) return folderId
  const node = tree.value.nodes.get(folderId)
  return node?.title || '未命名文件夹'
}

function folderPath(folderId: string): string {
  if (!tree.value) return ''
  return formatBookmarkPath(tree.value, folderId, true)
}

async function updateSelections(next: DisplayedFolder[]): Promise<void> {
  if (!tree.value) return
  await runAction(() =>
    settingsStore.setDisplayedFolders(normalizeDisplayedFolders(tree.value!, next)),
  )
}

async function removeEntry(folderId: string): Promise<void> {
  await updateSelections(displayedFolders.value.filter((entry) => entry.folderId !== folderId))
}

async function setEntryScope(folderId: string, scope: 'subtree' | 'direct'): Promise<void> {
  await updateSelections(
    displayedFolders.value.map((entry) =>
      entry.folderId === folderId ? { ...entry, scope } : entry,
    ),
  )
}

async function moveEntry(from: number, to: number): Promise<void> {
  if (from === to || from < 0 || to < 0 || to >= displayedFolders.value.length) return
  const next = displayedFolders.value.map((entry) => ({ ...entry }))
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(to, 0, moved)
  await updateSelections(next)
}

function validateSearch(): void {
  if (searchDraft.engine !== 'custom') return
  if (!normalizeCustomSearchTemplate(searchDraft.customUrlTemplate)) {
    throw new Error('自定义搜索地址必须使用 HTTPS 并包含 %s。')
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (!embeddedMode || event.key !== 'Escape' || window.parent === window) return
  event.preventDefault()
  window.parent.postMessage({ type: 'jtab:close-settings' }, location.origin)
}

async function saveSearch(): Promise<void> {
  await runAction(async () => {
    validateSearch()
    await settingsStore.setSearch({ ...searchDraft })
  }, '搜索设置已保存')
}

async function saveAppearance(successMessage?: string): Promise<void> {
  await runAction(
    () =>
      settingsStore.setAppearance({
        ...appearanceDraft,
        background: { ...appearanceDraft.background },
      }),
    successMessage,
  )
}

async function selectBookmarkLayout(layout: AppearanceSettings['bookmarkLayout']): Promise<void> {
  appearanceDraft.bookmarkLayout = layout
  await saveAppearance()
}

async function selectPreset(preset: (typeof PRESET_BACKGROUNDS)[number]): Promise<void> {
  appearanceDraft.background = { kind: 'bundled', id: preset.id, src: preset.src }
  await saveAppearance('背景已更新')
}

async function uploadBackground(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  backgroundBusy.value = true
  const previous = settings.value.appearance.background
  try {
    const asset = await localAssetRepository.saveBackground(file)
    appearanceDraft.background = { kind: 'local', assetId: asset.id }
    await settingsStore.setAppearance({
      ...appearanceDraft,
      background: { ...appearanceDraft.background },
    })
    if (previous.kind === 'local' && previous.assetId !== asset.id) {
      await localAssetRepository.deleteBackground(previous.assetId)
    }
    showToast('本地背景已压缩并保存')
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    backgroundBusy.value = false
  }
}

async function saveRemoteBackground(): Promise<void> {
  backgroundBusy.value = true
  try {
    const url = await preloadRemoteBackground(remoteUrl.value)
    appearanceDraft.background = { kind: 'remote', url }
    await settingsStore.setAppearance({
      ...appearanceDraft,
      background: { ...appearanceDraft.background },
    })
    remoteUrl.value = url
    showToast('远程背景已验证并保存')
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    backgroundBusy.value = false
  }
}

async function updateBackgroundPreview(): Promise<void> {
  const revision = ++previewRevision
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = null
  }
  const background = settings.value.appearance.background
  if (background.kind === 'bundled') {
    backgroundPreviewUrl.value = background.src
    return
  }
  if (background.kind === 'remote') {
    backgroundPreviewUrl.value = background.url
    return
  }
  const asset = await localAssetRepository.getBackground(background.assetId)
  if (revision !== previewRevision) return
  if (!asset) {
    backgroundPreviewUrl.value = ''
    showToast('本地背景资源已不存在，请重新选择。', 'error')
    return
  }
  previewObjectUrl = URL.createObjectURL(asset.blob)
  backgroundPreviewUrl.value = previewObjectUrl
}

async function saveCss(): Promise<void> {
  if (!cssValidation.value.valid) {
    showToast(cssValidation.value.issues[0]?.message ?? 'CSS 校验失败。', 'error')
    return
  }
  await runAction(
    () => settingsStore.setCustomCss(cssDraft.value, cssEnabled.value),
    '自定义 CSS 已保存',
  )
}

async function toggleCssEnabled(event: Event): Promise<void> {
  const enabled = (event.currentTarget as HTMLInputElement).checked
  if (enabled && !cssValidation.value.valid) {
    cssEnabled.value = false
    showToast(cssValidation.value.issues[0]?.message ?? 'CSS 校验失败。', 'error')
    return
  }
  cssEnabled.value = enabled
  const code = enabled ? cssDraft.value : settings.value.customCss.code
  await runAction(
    () => settingsStore.setCustomCss(code, enabled),
    enabled ? '自定义 CSS 已启用' : '自定义 CSS 已禁用',
  )
}

async function resetCss(): Promise<void> {
  await runAction(async () => {
    await settingsStore.resetCustomCss()
    cssDraft.value = ''
    cssEnabled.value = false
  }, '自定义 CSS 已重置')
}

async function refreshTree(): Promise<void> {
  try {
    tree.value = await repository.getTree()
    const removed = await settingsStore.reconcileDisplayedFolders(tree.value)
    if (removed.length > 0) {
      showToast(`已移除 ${removed.length} 个不存在的首页入口`, 'error')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    loadingTree.value = false
  }
}

function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(
  () => settings.value.search,
  (next) => Object.assign(searchDraft, next),
  { deep: true, immediate: true },
)
watch(
  () => settings.value.appearance,
  (next) => {
    Object.assign(appearanceDraft, next)
    appearanceDraft.background = { ...next.background }
  },
  { deep: true, immediate: true },
)
watch(
  () => settings.value.customCss,
  (next) => {
    cssDraft.value = next.code
    cssEnabled.value = next.enabled
  },
  { deep: true, immediate: true },
)
watch(
  () => activeBackgroundKey.value,
  () => void updateBackgroundPreview(),
  { immediate: true },
)

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeydown)
  void import('../../src/services/custom-css')
    .then((module) => {
      cssValidator.value = module.validateCustomCss
    })
    .catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    })
  try {
    await settingsStore.initialize()
    await refreshTree()
  } catch (error) {
    loadingTree.value = false
    showToast(error instanceof Error ? error.message : String(error), 'error')
  }
  unsubscribeBookmarks = repository.subscribe(
    () => void refreshTree(),
    (error) => showToast(error.message, 'error'),
  )
  await nextTick()
  if (entryList.value) {
    sortable = Sortable.create(entryList.value, {
      animation: 150,
      handle: '[data-drag-handle]',
      draggable: '[data-entry-id]',
      onEnd: (event) => {
        if (event.oldIndex === undefined || event.newIndex === undefined) return
        void moveEntry(event.oldIndex, event.newIndex)
      },
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  unsubscribeBookmarks?.()
  sortable?.destroy()
  settingsStore.dispose()
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div
    class="options-shell"
    :class="{ 'options-shell--embedded': embeddedMode }"
    data-jtab-component="options-page"
  >
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">J</span>
        <div>
          <strong>JTab</strong>
          <span>Fluid 设置</span>
        </div>
      </div>
      <div class="save-state" :class="{ 'is-saving': saving }" aria-live="polite">
        <LoaderCircle v-if="saving" :size="16" class="spin" />
        <CheckCircle2 v-else :size="16" />
        <span>{{ saving ? '正在保存' : '已保存到本机' }}</span>
      </div>
    </header>

    <div class="workbench">
      <aside class="sidebar" aria-label="设置导航">
        <div class="sidebar__heading">
          <Settings2 :size="18" aria-hidden="true" />
          <span>工作台</span>
        </div>
        <nav>
          <button type="button" @click="scrollToSection('folders')">
            <FolderTree :size="18" /><span>首页内容</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('background')">
            <Image :size="18" /><span>底图配置</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('collection')">
            <Palette :size="18" /><span>收藏栏配置</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('bookmarks')">
            <LayoutGrid :size="18" /><span>书签配置</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('search')">
            <Search :size="18" /><span>搜索与打开</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('custom-css')">
            <Code2 :size="18" /><span>自定义 CSS</span><ChevronRight :size="15" />
          </button>
          <button type="button" @click="scrollToSection('privacy')">
            <ShieldCheck :size="18" /><span>隐私</span><ChevronRight :size="15" />
          </button>
        </nav>
        <div class="sidebar__privacy">
          <ShieldCheck :size="18" aria-hidden="true" />
          <p>无账号、无同步、无遥测</p>
        </div>
      </aside>

      <main class="settings-content">
        <div v-if="settingsError" class="settings-error" role="alert">
          <AlertCircle :size="20" aria-hidden="true" />
          <div>
            <strong>无法加载本地设置</strong>
            <span>{{ settingsError }}</span>
          </div>
        </div>
        <section id="folders" class="settings-section" data-jtab-component="settings-section">
          <header class="section-heading">
            <div class="section-heading__icon">
              <FolderTree :size="20" />
            </div>
            <div>
              <span class="section-kicker">HOME CONTENT</span>
              <h1>首页内容</h1>
            </div>
            <span class="section-stat">{{ displayedFolders.length }} 个入口</span>
          </header>

          <div v-if="loadingTree || !initialized" class="section-loading">
            <LoaderCircle :size="22" class="spin" />
            <span>正在读取浏览器书签</span>
          </div>
          <div v-else-if="tree" class="folder-layout">
            <FolderPicker
              :tree="tree"
              :selections="displayedFolders"
              @update:selections="updateSelections"
            />

            <div class="entry-panel" data-jtab-component="displayed-folder-list">
              <div class="subheading">
                <div>
                  <h2>首页入口顺序</h2>
                  <span>拖动手柄或使用箭头调整</span>
                </div>
                <BookmarkCheck :size="19" aria-hidden="true" />
              </div>
              <div ref="entryList" class="entry-list">
                <article
                  v-for="(entry, index) in displayedFolders"
                  :key="entry.folderId"
                  class="entry-row"
                  :data-entry-id="entry.folderId"
                >
                  <button
                    class="drag-handle"
                    type="button"
                    data-drag-handle
                    :aria-label="`拖动 ${folderLabel(entry.folderId)}`"
                  >
                    <GripVertical :size="18" />
                  </button>
                  <div class="entry-row__label">
                    <strong>{{ folderLabel(entry.folderId) }}</strong>
                    <span :title="folderPath(entry.folderId)">{{
                      folderPath(entry.folderId)
                    }}</span>
                  </div>
                  <div class="segmented segmented--compact" aria-label="展示范围">
                    <button
                      type="button"
                      :class="{ 'is-active': entry.scope === 'subtree' }"
                      @click="setEntryScope(entry.folderId, 'subtree')"
                    >
                      含子级
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-active': entry.scope === 'direct' }"
                      @click="setEntryScope(entry.folderId, 'direct')"
                    >
                      仅当前层
                    </button>
                  </div>
                  <div class="entry-row__actions">
                    <button
                      class="icon-button"
                      type="button"
                      :disabled="index === 0"
                      title="上移"
                      aria-label="上移"
                      @click="moveEntry(index, index - 1)"
                    >
                      <ArrowUp :size="16" />
                    </button>
                    <button
                      class="icon-button"
                      type="button"
                      :disabled="index === displayedFolders.length - 1"
                      title="下移"
                      aria-label="下移"
                      @click="moveEntry(index, index + 1)"
                    >
                      <ArrowDown :size="16" />
                    </button>
                    <button
                      class="icon-button icon-button--danger"
                      type="button"
                      title="移除入口"
                      aria-label="移除入口"
                      @click="removeEntry(entry.folderId)"
                    >
                      <Trash2 :size="16" />
                    </button>
                  </div>
                </article>
                <div v-if="displayedFolders.length === 0" class="entry-empty">
                  <BookmarkCheck :size="24" />
                  <span>从左侧选择首页要显示的收藏夹</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="background"
          class="settings-section"
          data-jtab-component="settings-section"
          data-jtab-role="appearance-background"
        >
          <header class="section-heading">
            <div class="section-heading__icon section-heading__icon--orange">
              <Image :size="20" />
            </div>
            <div>
              <span class="section-kicker">FLUID BACKGROUND</span>
              <h2>底图配置</h2>
            </div>
          </header>

          <div class="appearance-layout">
            <div class="background-controls">
              <div class="preset-grid" data-jtab-role="background-presets">
                <button
                  v-for="preset in PRESET_BACKGROUNDS"
                  :key="preset.id"
                  class="preset-tile"
                  :class="{ 'is-active': activeBackgroundKey === `bundled:${preset.id}` }"
                  type="button"
                  @click="selectPreset(preset)"
                >
                  <img
                    :src="preset.src"
                    :alt="`${preset.name}预设背景`"
                    :style="{ backgroundColor: preset.tone }"
                  />
                  <span>{{ preset.name }}</span>
                  <Check v-if="activeBackgroundKey === `bundled:${preset.id}`" :size="16" />
                </button>
              </div>

              <div class="source-actions">
                <button
                  class="command-button"
                  type="button"
                  :disabled="backgroundBusy"
                  @click="uploadInput?.click()"
                >
                  <Upload :size="17" />
                  <span>上传本地图片</span>
                </button>
                <input
                  ref="uploadInput"
                  class="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  @change="uploadBackground"
                />
                <span>JPEG / PNG / WebP，最大 20 MB</span>
              </div>

              <div class="remote-field">
                <label for="remote-background">HTTPS 图片地址</label>
                <div>
                  <Link :size="17" aria-hidden="true" />
                  <input
                    id="remote-background"
                    v-model="remoteUrl"
                    type="url"
                    placeholder="https://example.com/background.webp"
                  />
                  <button
                    class="command-button command-button--dark"
                    type="button"
                    :disabled="backgroundBusy || !remoteUrl.trim()"
                    @click="saveRemoteBackground"
                  >
                    {{ backgroundBusy ? '验证中' : '验证并使用' }}
                  </button>
                </div>
              </div>
            </div>

            <div
              class="appearance-preview"
              :style="{ '--preview-overlay': appearanceDraft.overlay / 100 }"
            >
              <img
                v-if="backgroundPreviewUrl"
                :src="backgroundPreviewUrl"
                alt="当前背景预览"
                referrerpolicy="no-referrer"
                :style="{
                  filter: `brightness(${appearanceDraft.brightness}%) blur(${appearanceDraft.blur}px)`,
                  objectPosition: `${appearanceDraft.focalX}% ${appearanceDraft.focalY}%`,
                }"
              />
              <div class="appearance-preview__overlay" />
              <div class="appearance-preview__mock">
                <span class="mock-search"><Search :size="15" />搜索书签或网页</span>
                <span class="mock-tile" :style="{ '--mock-accent': appearanceDraft.accent }"
                  >J</span
                >
                <span class="mock-tile">设</span>
                <span class="mock-tile">工</span>
              </div>
            </div>
          </div>

          <div class="range-grid range-grid--background">
            <label class="range-control">
              <span
                >遮罩<strong>{{ appearanceDraft.overlay }}%</strong></span
              >
              <input
                v-model.number="appearanceDraft.overlay"
                type="range"
                min="0"
                max="85"
                @change="saveAppearance()"
              />
            </label>
            <label class="range-control">
              <span
                >亮度<strong>{{ appearanceDraft.brightness }}%</strong></span
              >
              <input
                v-model.number="appearanceDraft.brightness"
                type="range"
                min="40"
                max="140"
                @change="saveAppearance()"
              />
            </label>
            <label class="range-control">
              <span
                >模糊<strong>{{ appearanceDraft.blur }}px</strong></span
              >
              <input
                v-model.number="appearanceDraft.blur"
                type="range"
                min="0"
                max="24"
                @change="saveAppearance()"
              />
            </label>
            <label class="range-control">
              <span
                >水平焦点<strong>{{ appearanceDraft.focalX }}%</strong></span
              >
              <input
                v-model.number="appearanceDraft.focalX"
                type="range"
                min="0"
                max="100"
                @change="saveAppearance()"
              />
            </label>
            <label class="range-control">
              <span
                >垂直焦点<strong>{{ appearanceDraft.focalY }}%</strong></span
              >
              <input
                v-model.number="appearanceDraft.focalY"
                type="range"
                min="0"
                max="100"
                @change="saveAppearance()"
              />
            </label>
            <label class="color-control">
              <span>强调色</span>
              <input v-model="appearanceDraft.accent" type="color" @change="saveAppearance()" />
              <code>{{ appearanceDraft.accent }}</code>
            </label>
          </div>
        </section>

        <section
          id="collection"
          class="settings-section"
          data-jtab-component="settings-section"
          data-jtab-role="appearance-collection"
        >
          <header class="section-heading">
            <div class="section-heading__icon">
              <Palette :size="20" />
            </div>
            <div>
              <span class="section-kicker">COLLECTION SURFACE</span>
              <h2>收藏栏配置</h2>
            </div>
          </header>

          <div class="appearance-control-layout">
            <div class="range-stack">
              <label class="range-control">
                <span
                  >收藏栏透明度<strong>{{ appearanceDraft.contentOpacity }}%</strong></span
                >
                <input
                  v-model.number="appearanceDraft.contentOpacity"
                  type="range"
                  min="0"
                  max="100"
                  @change="saveAppearance()"
                />
              </label>
              <label class="range-control">
                <span
                  >收藏栏磨砂<strong>{{ appearanceDraft.contentBlur }}px</strong></span
                >
                <input
                  v-model.number="appearanceDraft.contentBlur"
                  type="range"
                  min="0"
                  max="24"
                  @change="saveAppearance()"
                />
              </label>
            </div>

            <div
              class="surface-preview"
              :class="{ 'uses-light-text': collectionPreviewUsesLightText }"
              :style="{
                '--preview-content-opacity': appearanceDraft.contentOpacity / 100,
                '--preview-content-blur': `${appearanceDraft.contentBlur}px`,
              }"
              role="img"
              aria-label="收藏栏效果预览"
            >
              <img
                v-if="backgroundPreviewUrl"
                :src="backgroundPreviewUrl"
                alt=""
                referrerpolicy="no-referrer"
                :style="{
                  filter: `brightness(${appearanceDraft.brightness}%) blur(${appearanceDraft.blur}px)`,
                  objectPosition: `${appearanceDraft.focalX}% ${appearanceDraft.focalY}%`,
                }"
              />
              <div class="surface-preview__shade" />
              <div class="collection-preview__panel">
                <div class="collection-preview__heading">
                  <FolderTree :size="17" />
                  <strong>工作收藏</strong>
                  <span>12 项</span>
                </div>
                <div class="collection-preview__rows">
                  <span>项目文档</span>
                  <span>设计资源</span>
                  <span>开发工具</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="bookmarks"
          class="settings-section"
          data-jtab-component="settings-section"
          data-jtab-role="appearance-bookmarks"
        >
          <header class="section-heading">
            <div class="section-heading__icon section-heading__icon--blue">
              <LayoutGrid :size="20" />
            </div>
            <div>
              <span class="section-kicker">BOOKMARK SURFACE</span>
              <h2>书签配置</h2>
            </div>
          </header>

          <div class="appearance-control-layout">
            <div class="bookmark-controls">
              <fieldset class="field-group layout-mode-control">
                <legend>书签展示</legend>
                <div class="segmented">
                  <button
                    type="button"
                    :class="{ 'is-active': appearanceDraft.bookmarkLayout === 'detail' }"
                    @click="selectBookmarkLayout('detail')"
                  >
                    <List :size="17" />详细卡片
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-active': appearanceDraft.bookmarkLayout === 'icon' }"
                    @click="selectBookmarkLayout('icon')"
                  >
                    <LayoutGrid :size="17" />单图标
                  </button>
                </div>
              </fieldset>

              <div class="range-stack">
                <label class="range-control">
                  <span
                    >书签底层透明度<strong>{{ appearanceDraft.bookmarkCardOpacity }}%</strong></span
                  >
                  <input
                    v-model.number="appearanceDraft.bookmarkCardOpacity"
                    type="range"
                    min="0"
                    max="100"
                    @change="saveAppearance()"
                  />
                </label>
                <label class="range-control">
                  <span
                    >详细卡片圆角<strong
                      >{{ appearanceDraft.bookmarkDetailCardRadius }}px</strong
                    ></span
                  >
                  <input
                    v-model.number="appearanceDraft.bookmarkDetailCardRadius"
                    type="range"
                    min="0"
                    max="24"
                    @change="saveAppearance()"
                  />
                </label>
                <label class="range-control">
                  <span
                    >图标卡片圆角<strong
                      >{{ appearanceDraft.bookmarkIconCardRadius }}%</strong
                    ></span
                  >
                  <input
                    v-model.number="appearanceDraft.bookmarkIconCardRadius"
                    type="range"
                    min="0"
                    max="50"
                    @change="saveAppearance()"
                  />
                </label>
              </div>
            </div>

            <div
              class="bookmark-preview"
              :class="[
                `bookmark-preview--${appearanceDraft.bookmarkLayout}`,
                { 'uses-light-text': bookmarkPreviewUsesLightText },
              ]"
              :style="{
                '--preview-content-opacity': appearanceDraft.contentOpacity / 100,
                '--preview-card-opacity': appearanceDraft.bookmarkCardOpacity / 100,
                '--preview-detail-radius': `${appearanceDraft.bookmarkDetailCardRadius}px`,
                '--preview-icon-radius': `${appearanceDraft.bookmarkIconCardRadius}%`,
                '--preview-content-blur': `${appearanceDraft.contentBlur}px`,
              }"
              role="img"
              aria-label="书签卡片效果预览"
            >
              <img
                v-if="backgroundPreviewUrl"
                :src="backgroundPreviewUrl"
                alt=""
                referrerpolicy="no-referrer"
                :style="{
                  filter: `brightness(${appearanceDraft.brightness}%) blur(${appearanceDraft.blur}px)`,
                  objectPosition: `${appearanceDraft.focalX}% ${appearanceDraft.focalY}%`,
                }"
              />
              <div class="surface-preview__shade" />
              <div class="bookmark-preview__panel">
                <article class="preview-bookmark">
                  <span class="preview-bookmark__icon">J</span>
                  <span class="preview-bookmark__copy"
                    ><strong>JTab</strong><small>常用工具</small></span
                  >
                </article>
                <article class="preview-bookmark">
                  <span class="preview-bookmark__icon preview-bookmark__icon--green">设</span>
                  <span class="preview-bookmark__copy"
                    ><strong>设计资源</strong><small>设计收藏</small></span
                  >
                </article>
                <article class="preview-bookmark">
                  <span class="preview-bookmark__icon preview-bookmark__icon--blue">工</span>
                  <span class="preview-bookmark__copy"
                    ><strong>工作台</strong><small>项目入口</small></span
                  >
                </article>
              </div>
            </div>
          </div>
        </section>

        <section id="search" class="settings-section" data-jtab-component="settings-section">
          <header class="section-heading">
            <div class="section-heading__icon section-heading__icon--blue">
              <Search :size="20" />
            </div>
            <div>
              <span class="section-kicker">SEARCH</span>
              <h2>搜索与打开</h2>
            </div>
          </header>

          <div class="form-grid">
            <fieldset class="field-group field-group--wide">
              <legend>搜索引擎</legend>
              <div class="segmented segmented--engines">
                <button
                  v-for="engine in SEARCH_ENGINES"
                  :key="engine.id"
                  type="button"
                  :class="{ 'is-active': searchDraft.engine === engine.id }"
                  @click="searchDraft.engine = engine.id"
                >
                  {{ engine.label }}
                </button>
              </div>
            </fieldset>
            <fieldset class="field-group">
              <legend>打开方式</legend>
              <div class="segmented">
                <button
                  type="button"
                  :class="{ 'is-active': searchDraft.openMode === 'current' }"
                  @click="searchDraft.openMode = 'current'"
                >
                  <Monitor :size="16" />当前标签页
                </button>
                <button
                  type="button"
                  :class="{ 'is-active': searchDraft.openMode === 'new' }"
                  @click="searchDraft.openMode = 'new'"
                >
                  <ExternalLink :size="16" />新标签页
                </button>
              </div>
            </fieldset>
            <template v-if="searchDraft.engine === 'custom'">
              <label class="input-field">
                <span>名称</span>
                <input
                  v-model="searchDraft.customName"
                  type="text"
                  maxlength="40"
                  placeholder="内部搜索"
                />
              </label>
              <label class="input-field input-field--wide">
                <span>HTTPS 地址模板</span>
                <input
                  v-model="searchDraft.customUrlTemplate"
                  type="url"
                  placeholder="https://search.example.com/?q=%s"
                />
              </label>
            </template>
          </div>
          <div class="section-actions">
            <button
              class="command-button command-button--primary"
              type="button"
              @click="saveSearch"
            >
              <Check :size="17" />保存搜索设置
            </button>
          </div>
        </section>

        <section id="custom-css" class="settings-section" data-jtab-component="settings-section">
          <header class="section-heading">
            <div class="section-heading__icon section-heading__icon--ink">
              <Code2 :size="20" />
            </div>
            <div>
              <span class="section-kicker">USER LAYER</span>
              <h2>自定义 CSS</h2>
            </div>
            <label class="switch-control">
              <input :checked="cssEnabled" type="checkbox" @change="toggleCssEnabled" />
              <span aria-hidden="true" />
              <strong>{{ cssEnabled ? '已启用' : '已禁用' }}</strong>
            </label>
          </header>

          <div class="css-layout">
            <div class="code-editor">
              <div class="code-editor__toolbar">
                <span>user.css</span>
                <span :class="{ 'is-error': !cssValidation.valid }"
                  >{{ Math.ceil(cssBytes / 1024) }} / 100 KB</span
                >
              </div>
              <textarea
                v-model="cssDraft"
                spellcheck="false"
                aria-label="自定义 CSS 编辑器"
                placeholder="[data-jtab-component='bookmark-tile'] {&#10;  border-color: var(--jtab-accent);&#10;}"
              />
              <div
                class="validation-line"
                :class="{ 'is-error': !cssValidation.valid }"
                aria-live="polite"
              >
                <AlertCircle v-if="!cssValidation.valid" :size="16" />
                <CheckCircle2 v-else :size="16" />
                <span>{{
                  cssValidation.valid ? '语法与隐私校验通过' : cssValidation.issues[0]?.message
                }}</span>
              </div>
            </div>
            <div class="css-preview">
              <div class="css-preview__label">隔离预览</div>
              <iframe title="自定义 CSS 隔离预览" sandbox="" :srcdoc="cssPreviewDocument" />
            </div>
          </div>
          <div class="section-actions section-actions--split">
            <p><ShieldCheck :size="16" />禁止 @import 与远程 URL；Options 页面不会加载用户 CSS。</p>
            <div>
              <button class="command-button" type="button" @click="resetCss">
                <RotateCcw :size="17" />重置
              </button>
              <button
                class="command-button command-button--primary"
                type="button"
                :disabled="!cssValidation.valid"
                @click="saveCss"
              >
                <Check :size="17" />保存 CSS
              </button>
            </div>
          </div>
        </section>

        <section
          id="privacy"
          class="settings-section settings-section--last"
          data-jtab-component="settings-section"
        >
          <header class="section-heading">
            <div class="section-heading__icon section-heading__icon--safe">
              <ShieldCheck :size="20" />
            </div>
            <div>
              <span class="section-kicker">PRIVACY</span>
              <h2>隐私</h2>
            </div>
          </header>

          <div class="privacy-grid">
            <article>
              <strong>浏览器书签</strong>
              <span>仅在本机读取与管理，不上传域名或书签内容。</span>
            </article>
            <article>
              <strong>设置与图片</strong>
              <span>设置保存在 storage.local，本地图片保存在 IndexedDB。</span>
            </article>
            <article>
              <strong>网站图标</strong>
              <span>仅使用本地图标、浏览器缓存或文字字标，不调用第三方图标服务。</span>
            </article>
            <article>
              <strong>联网行为</strong>
              <span>仅在主动搜索或选择 HTTPS 远程背景时访问对应地址。</span>
            </article>
          </div>
          <div class="privacy-banner">
            <ShieldCheck :size="22" />
            <div><strong>本地优先</strong><span>JTab 不提供登录、云同步和遥测。</span></div>
          </div>
        </section>
      </main>
    </div>

    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.kind}`" role="status">
        <CheckCircle2 v-if="toast.kind === 'success'" :size="18" />
        <AlertCircle v-else :size="18" />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </div>
</template>
