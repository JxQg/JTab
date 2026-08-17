import { describe, expect, it, vi } from 'vitest'

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
  migrateSettings,
} from '../../src/services/settings'

describe('settings migration', () => {
  it('creates independent v2 defaults for missing data', () => {
    const first = migrateSettings(undefined)
    const second = migrateSettings(undefined)

    expect(first).toEqual(DEFAULT_SETTINGS)
    expect(first).not.toBe(second)
    expect(first.appearance.background).not.toBe(second.appearance.background)
  })

  it('normalizes legacy values and keeps opaque folder IDs', () => {
    const result = migrateSettings({
      schemaVersion: 1,
      displayedFolders: [
        { folderId: 'toolbar_____', scope: 'direct', order: 4 },
        { folderId: 'toolbar_____', scope: 'subtree', order: 8 },
        { folderId: 'mobile______', scope: 'unknown' },
      ],
      search: { engine: 'bing', openMode: 'new' },
      appearance: {
        background: { kind: 'remote', url: 'https://images.example.test/a.webp' },
        overlay: 999,
        brightness: 10,
        blur: 99,
        focalX: -20,
        focalY: 130,
        accent: '#12abEF',
      },
      customCss: { enabled: true, code: '.tile { color: red }' },
    })

    expect(result.displayedFolders).toEqual([
      { folderId: 'toolbar_____', scope: 'direct', order: 4 },
      { folderId: 'mobile______', scope: 'subtree', order: 2 },
    ])
    expect(result.search.engine).toBe('bing')
    expect(result.search.openMode).toBe('new')
    expect(result.appearance).toMatchObject({
      overlay: 85,
      brightness: 40,
      blur: 24,
      focalX: 0,
      focalY: 100,
      accent: '#12abEF',
      contentOpacity: 82,
      contentBlur: 0,
      bookmarkLayout: 'detail',
      bookmarkCardOpacity: 80,
      bookmarkDetailCardRadius: 8,
      bookmarkIconCardRadius: 24,
    })
    expect(result.appearance.background).toEqual({
      kind: 'remote',
      url: 'https://images.example.test/a.webp',
    })
  })

  it('rejects insecure remote backgrounds during migration', () => {
    const result = migrateSettings({
      appearance: { background: { kind: 'remote', url: 'http://tracker.test/bg.png' } },
    })

    expect(result.appearance.background).toEqual(DEFAULT_SETTINGS.appearance.background)
  })

  it('never keeps an invalid custom engine active', () => {
    const insecure = migrateSettings({
      search: {
        engine: 'custom',
        customName: 'Private search',
        customUrlTemplate: 'http://search.example.test/?q=%s',
      },
    })
    const valid = migrateSettings({
      search: {
        engine: 'custom',
        customName: 'Private search',
        customUrlTemplate: 'https://search.example.test/?q=%s',
      },
    })

    expect(insecure.search.engine).toBe('google')
    expect(valid.search.engine).toBe('custom')
  })

  it('validates bookmark presentation settings and falls back from invalid values', () => {
    const bounded = migrateSettings({
      schemaVersion: 2,
      appearance: {
        contentOpacity: 120,
        contentBlur: 99,
        bookmarkLayout: 'icon',
        bookmarkCardOpacity: -10,
        bookmarkDetailCardRadius: 30,
        bookmarkIconCardRadius: 60,
      },
    })
    const invalid = migrateSettings({
      schemaVersion: 2,
      appearance: {
        contentOpacity: Number.NaN,
        contentBlur: '12',
        bookmarkLayout: 'compact',
        bookmarkCardOpacity: Number.NaN,
        bookmarkDetailCardRadius: '8',
        bookmarkIconCardRadius: '50',
      },
    })

    expect(bounded.appearance).toMatchObject({
      contentOpacity: 100,
      contentBlur: 24,
      bookmarkLayout: 'icon',
      bookmarkCardOpacity: 0,
      bookmarkDetailCardRadius: 24,
      bookmarkIconCardRadius: 50,
    })
    expect(invalid.appearance).toMatchObject({
      contentOpacity: DEFAULT_SETTINGS.appearance.contentOpacity,
      contentBlur: DEFAULT_SETTINGS.appearance.contentBlur,
      bookmarkLayout: DEFAULT_SETTINGS.appearance.bookmarkLayout,
      bookmarkCardOpacity: DEFAULT_SETTINGS.appearance.bookmarkCardOpacity,
      bookmarkDetailCardRadius: DEFAULT_SETTINGS.appearance.bookmarkDetailCardRadius,
      bookmarkIconCardRadius: DEFAULT_SETTINGS.appearance.bookmarkIconCardRadius,
    })
  })

  it.each([
    ['v1', { schemaVersion: 1, appearance: { bookmarkIconRadius: 37 } }],
    ['versionless', { appearance: { bookmarkIconRadius: 37 } }],
  ])('migrates the legacy icon radius from %s data only to the icon card', (_, legacy) => {
    const result = migrateSettings(legacy)

    expect(result.schemaVersion).toBe(2)
    expect(result.appearance).toMatchObject({
      contentBlur: 0,
      bookmarkCardOpacity: 80,
      bookmarkDetailCardRadius: 8,
      bookmarkIconCardRadius: 37,
    })
    expect(result.appearance).not.toHaveProperty('bookmarkIconRadius')
  })

  it('does not let a legacy key override a v2 icon card radius', () => {
    const result = migrateSettings({
      schemaVersion: 2,
      appearance: { bookmarkIconRadius: 49, bookmarkIconCardRadius: 12 },
    })

    expect(result.appearance.bookmarkIconCardRadius).toBe(12)
    expect(result.appearance).not.toHaveProperty('bookmarkIconRadius')
  })

  it('preserves zero values and independently bounds both card radius modes', () => {
    const result = migrateSettings({
      schemaVersion: 2,
      appearance: {
        contentOpacity: 0,
        contentBlur: 0,
        bookmarkCardOpacity: 0,
        bookmarkDetailCardRadius: 0,
        bookmarkIconCardRadius: 0,
      },
    })

    expect(result.appearance).toMatchObject({
      contentOpacity: 0,
      contentBlur: 0,
      bookmarkCardOpacity: 0,
      bookmarkDetailCardRadius: 0,
      bookmarkIconCardRadius: 0,
    })
  })

  it('is idempotent for v2 settings', () => {
    const first = migrateSettings(DEFAULT_SETTINGS)
    const second = migrateSettings(first)

    expect(first).toEqual(DEFAULT_SETTINGS)
    expect(second).toEqual(first)
  })

  it('rejects settings created by a newer schema version', () => {
    expect(() => migrateSettings({ schemaVersion: 3 })).toThrowError(
      UnsupportedSettingsVersionError,
    )
    expect(() => migrateSettings({ schemaVersion: 3 })).toThrowError(
      '检测到设置版本 3，当前支持的最高版本为 2',
    )
  })

  it('keeps tampered CSS editable but disables it before New Tab can inject it', () => {
    const code = '.tile { background: url(https://tracker.example.test/pixel) }'
    const result = migrateSettings({ customCss: { enabled: true, code } })

    expect(result.customCss).toEqual({ enabled: false, code })
  })
})

describe('SettingsService', () => {
  it('writes a migrated default when storage is empty', async () => {
    const values: Record<string, unknown> = {}
    const storageArea = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items)
      }),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })

    const settings = await service.load()

    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(storageArea.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS })
  })

  it('writes a legacy migration once and leaves the resulting v2 value untouched', async () => {
    const values: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: 1,
        appearance: { bookmarkIconRadius: 31 },
      },
    }
    const storageArea = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items)
      }),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })

    const first = await service.load()
    const second = await service.load()

    expect(first.appearance.bookmarkIconCardRadius).toBe(31)
    expect(first.appearance).not.toHaveProperty('bookmarkIconRadius')
    expect(second).toEqual(first)
    expect(storageArea.set).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite already normalized v2 settings', async () => {
    const storageArea = {
      get: vi.fn(async () => ({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS })),
      set: vi.fn(async () => undefined),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })

    await expect(service.load()).resolves.toEqual(DEFAULT_SETTINGS)
    expect(storageArea.set).not.toHaveBeenCalled()
  })

  it('preserves future-version storage and reports a compatibility error', async () => {
    const futureSettings = { schemaVersion: 3, futureOption: true }
    const values: Record<string, unknown> = { [SETTINGS_STORAGE_KEY]: futureSettings }
    const storageArea = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items)
      }),
    }
    const storageChanges = { addListener: vi.fn(), removeListener: vi.fn() }
    const service = new SettingsService({ storageArea, storageChanges })

    await expect(service.load()).rejects.toThrowError(UnsupportedSettingsVersionError)
    expect(storageArea.set).not.toHaveBeenCalled()
    expect(values[SETTINGS_STORAGE_KEY]).toBe(futureSettings)
  })

  it('only forwards changes from storage.local and unsubscribes', () => {
    let listener:
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    const storageArea = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
    const storageChanges = {
      addListener: vi.fn((next: typeof listener) => {
        listener = next
      }),
      removeListener: vi.fn(),
    }
    const service = new SettingsService({ storageArea, storageChanges })
    const observer = vi.fn()
    const unsubscribe = service.subscribe(observer)

    listener?.({ [SETTINGS_STORAGE_KEY]: { newValue: { search: { engine: 'baidu' } } } }, 'sync')
    expect(observer).not.toHaveBeenCalled()
    listener?.({ [SETTINGS_STORAGE_KEY]: { newValue: { search: { engine: 'baidu' } } } }, 'local')
    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ engine: 'baidu' }) }),
    )

    unsubscribe()
    expect(storageChanges.removeListener).toHaveBeenCalledWith(listener)
  })

  it('routes a future-version storage change to onError without replacing settings', () => {
    let listener:
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    const storageArea = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
    const storageChanges = {
      addListener: vi.fn((next: typeof listener) => {
        listener = next
      }),
      removeListener: vi.fn(),
    }
    const service = new SettingsService({ storageArea, storageChanges })
    const observer = vi.fn()
    const onError = vi.fn()
    service.subscribe(observer, onError)

    listener?.({ [SETTINGS_STORAGE_KEY]: { newValue: { schemaVersion: 3 } } }, 'local')

    expect(observer).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(UnsupportedSettingsVersionError))
  })
})
