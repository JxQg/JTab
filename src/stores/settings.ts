import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { DEFAULT_SETTINGS } from '../core/defaults'
import { normalizeDisplayedFolders } from '../core/bookmarks'
import type {
  AppearanceSettings,
  BookmarkTree,
  DisplayedFolder,
  SearchSettings,
  UserSettingsV2,
} from '../core/types'
import { passesCustomCssPrivacyBoundary } from '../services/custom-css-privacy'
import {
  cloneSettings,
  settingsService,
  UnsupportedSettingsVersionError,
  type SettingsService,
} from '../services/settings'

function sameFolders(left: readonly DisplayedFolder[], right: readonly DisplayedFolder[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (folder, index) =>
        folder.folderId === right[index]?.folderId && folder.scope === right[index]?.scope,
    )
  )
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<UserSettingsV2>(cloneSettings(DEFAULT_SETTINGS))
  const initialized = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  let activeService: SettingsService = settingsService
  let unsubscribe: (() => void) | null = null
  let saveTail: Promise<void> = Promise.resolve()
  let writeRevision = 0
  let pendingWrites = 0
  let compatibilityWriteBlock: UnsupportedSettingsVersionError | null = null

  const displayedFolders = computed(() =>
    [...settings.value.displayedFolders].sort((left, right) => left.order - right.order),
  )

  async function initialize(service: SettingsService = settingsService): Promise<void> {
    if (initialized.value && activeService === service) return
    unsubscribe?.()
    activeService = service
    error.value = null
    try {
      settings.value = await activeService.load()
      compatibilityWriteBlock = null
      unsubscribe = activeService.subscribe(
        (next) => {
          compatibilityWriteBlock = null
          error.value = null
          if (pendingWrites === 0) settings.value = cloneSettings(next)
        },
        (cause) => {
          if (cause instanceof UnsupportedSettingsVersionError) {
            compatibilityWriteBlock = cause
          }
          error.value = cause.message
        },
      )
      initialized.value = true
    } catch (cause) {
      if (cause instanceof UnsupportedSettingsVersionError) {
        compatibilityWriteBlock = cause
      }
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function persist(next: UserSettingsV2): Promise<void> {
    if (compatibilityWriteBlock) {
      error.value = compatibilityWriteBlock.message
      throw compatibilityWriteBlock
    }
    const previous = cloneSettings(settings.value)
    const revision = ++writeRevision
    pendingWrites += 1
    settings.value = cloneSettings(next)
    saving.value = true
    error.value = null
    const operation = saveTail.then(async () => {
      const saved = await activeService.save(next)
      if (revision === writeRevision) settings.value = saved
    })
    saveTail = operation.catch(() => undefined)
    try {
      await operation
    } catch (cause) {
      if (revision === writeRevision) settings.value = previous
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      pendingWrites -= 1
      saving.value = pendingWrites > 0
    }
  }

  async function setDisplayedFolders(folders: readonly DisplayedFolder[]): Promise<void> {
    await persist({
      ...cloneSettings(settings.value),
      displayedFolders: folders.map((folder, order) => ({ ...folder, order })),
    })
  }

  async function setSearch(search: SearchSettings): Promise<void> {
    await persist({ ...cloneSettings(settings.value), search: { ...search } })
  }

  async function setAppearance(appearance: AppearanceSettings): Promise<void> {
    await persist({
      ...cloneSettings(settings.value),
      appearance: { ...appearance, background: { ...appearance.background } },
    })
  }

  async function setCustomCss(code: string, enabled: boolean): Promise<void> {
    if (!passesCustomCssPrivacyBoundary(code)) {
      throw new Error('自定义 CSS 包含不允许的远程资源或超过 100 KB。')
    }
    await persist({
      ...cloneSettings(settings.value),
      customCss: { code, enabled },
    })
  }

  async function resetCustomCss(): Promise<void> {
    await persist({
      ...cloneSettings(settings.value),
      customCss: { ...DEFAULT_SETTINGS.customCss },
    })
  }

  async function reconcileDisplayedFolders(tree: BookmarkTree): Promise<string[]> {
    const normalized = normalizeDisplayedFolders(tree, settings.value.displayedFolders)
    if (sameFolders(settings.value.displayedFolders, normalized)) return []
    const retained = new Set(normalized.map(({ folderId }) => folderId))
    const removed = settings.value.displayedFolders
      .map(({ folderId }) => folderId)
      .filter((folderId) => !retained.has(folderId))
    await setDisplayedFolders(normalized)
    return removed
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    initialized.value = false
  }

  return {
    settings,
    displayedFolders,
    initialized,
    saving,
    error,
    initialize,
    setDisplayedFolders,
    setSearch,
    setAppearance,
    setCustomCss,
    resetCustomCss,
    reconcileDisplayedFolders,
    dispose,
  }
})
