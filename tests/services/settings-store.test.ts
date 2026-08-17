import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}))

import { DEFAULT_SETTINGS } from '../../src/core/defaults'
import {
  SETTINGS_STORAGE_KEY,
  SettingsService,
  UnsupportedSettingsVersionError,
  cloneSettings,
} from '../../src/services/settings'
import { useSettingsStore } from '../../src/stores/settings'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('settings store write queue', () => {
  it('does not let an older completed write overwrite a newer optimistic update', async () => {
    let releaseFirstWrite: (() => void) | undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let writes = 0
    const stored: Record<string, unknown> = { [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS }
    const storageArea = {
      get: vi.fn(async () => ({ ...stored })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        writes += 1
        if (writes === 1) await firstWrite
        Object.assign(stored, items)
      }),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })
    const store = useSettingsStore()
    await store.initialize(service)

    const first = store.setSearch({
      ...store.settings.search,
      engine: 'bing',
    })
    const second = store.setSearch({
      ...store.settings.search,
      engine: 'baidu',
    })

    expect(store.settings.search.engine).toBe('baidu')
    releaseFirstWrite?.()
    await Promise.all([first, second])

    expect(store.settings.search.engine).toBe('baidu')
    expect(store.saving).toBe(false)
    expect(storageArea.set).toHaveBeenCalledTimes(2)
  })

  it('surfaces a future-version load error without overwriting storage', async () => {
    const futureSettings = { schemaVersion: 3, futureOption: true }
    const storageArea = {
      get: vi.fn(async () => ({ [SETTINGS_STORAGE_KEY]: futureSettings })),
      set: vi.fn(async () => undefined),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })
    const store = useSettingsStore()

    await expect(store.initialize(service)).rejects.toThrowError(UnsupportedSettingsVersionError)

    expect(store.initialized).toBe(false)
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
    expect(store.error).toContain('检测到设置版本 3，当前支持的最高版本为 2')
    expect(storageArea.set).not.toHaveBeenCalled()
  })

  it('keeps current settings and blocks writes after a future-version storage change', async () => {
    let storageListener:
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    const storageArea = {
      get: vi.fn(async () => ({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS })),
      set: vi.fn(async () => undefined),
    }
    const storageChanges = {
      addListener: vi.fn((listener: typeof storageListener) => {
        storageListener = listener
      }),
      removeListener: vi.fn(),
    }
    const service = new SettingsService({ storageArea, storageChanges })
    const store = useSettingsStore()
    await store.initialize(service)
    const currentSettings = cloneSettings(store.settings)

    storageListener?.(
      { [SETTINGS_STORAGE_KEY]: { newValue: { schemaVersion: 3, futureOption: true } } },
      'local',
    )

    expect(store.settings).toEqual(currentSettings)
    expect(store.error).toContain('检测到设置版本 3，当前支持的最高版本为 2')
    await expect(
      store.setSearch({ ...store.settings.search, engine: 'bing' }),
    ).rejects.toThrowError(UnsupportedSettingsVersionError)
    expect(storageArea.set).not.toHaveBeenCalled()
  })
})
