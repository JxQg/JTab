import { browser } from 'wxt/browser'

import { DEFAULT_SETTINGS } from '../core/defaults'
import { normalizeCustomSearchTemplate } from '../core/search'
import type {
  AppearanceSettings,
  BackgroundRef,
  DisplayedFolder,
  SearchSettings,
  UserSettingsV2,
} from '../core/types'
import { MAX_CUSTOM_CSS_BYTES, passesCustomCssPrivacyBoundary } from './custom-css-privacy'

export const SETTINGS_STORAGE_KEY = 'jtab.settings'
export const CURRENT_SETTINGS_SCHEMA_VERSION = 2 as const

export class UnsupportedSettingsVersionError extends Error {
  readonly detectedVersion: number
  readonly supportedVersion = CURRENT_SETTINGS_SCHEMA_VERSION

  constructor(detectedVersion: number) {
    super(
      `检测到设置版本 ${detectedVersion}，当前支持的最高版本为 ${CURRENT_SETTINGS_SCHEMA_VERSION}。请升级 JTab 后重试。`,
    )
    this.name = 'UnsupportedSettingsVersionError'
    this.detectedVersion = detectedVersion
  }
}

interface StorageAreaPort {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

interface StorageChangeValue {
  newValue?: unknown
  oldValue?: unknown
}

interface StorageChangesPort {
  addListener(
    listener: (changes: Record<string, StorageChangeValue>, areaName: string) => void,
  ): void
  removeListener(
    listener: (changes: Record<string, StorageChangeValue>, areaName: string) => void,
  ): void
}

export interface SettingsServiceOptions {
  storageArea?: StorageAreaPort
  storageChanges?: StorageChangesPort
}

export type SettingsListener = (settings: UserSettingsV2) => void
export type SettingsErrorListener = (error: Error) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function cloneBackground(background: BackgroundRef): BackgroundRef {
  return { ...background }
}

export function cloneSettings(settings: UserSettingsV2): UserSettingsV2 {
  return {
    schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    displayedFolders: settings.displayedFolders.map((folder) => ({ ...folder })),
    search: { ...settings.search },
    appearance: {
      ...settings.appearance,
      background: cloneBackground(settings.appearance.background),
    },
    customCss: { ...settings.customCss },
  }
}

function assertSupportedSettingsVersion(value: unknown): void {
  if (!isRecord(value)) return
  const version = value.schemaVersion
  if (typeof version === 'number' && version > CURRENT_SETTINGS_SCHEMA_VERSION) {
    throw new UnsupportedSettingsVersionError(version)
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function migrateDisplayedFolders(value: unknown): DisplayedFolder[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  return value.flatMap((candidate, inputOrder) => {
    if (!isRecord(candidate)) return []
    const folderId = typeof candidate.folderId === 'string' ? candidate.folderId.trim() : ''
    if (!folderId || seen.has(folderId)) return []
    seen.add(folderId)
    return [
      {
        folderId,
        scope: candidate.scope === 'direct' ? 'direct' : 'subtree',
        order:
          typeof candidate.order === 'number' && Number.isFinite(candidate.order)
            ? candidate.order
            : inputOrder,
      } satisfies DisplayedFolder,
    ]
  })
}

function migrateSearch(value: unknown): SearchSettings {
  const raw = isRecord(value) ? value : {}
  const requestedEngine =
    raw.engine === 'bing' ||
    raw.engine === 'baidu' ||
    raw.engine === 'duckduckgo' ||
    raw.engine === 'custom'
      ? raw.engine
      : 'google'
  const customUrlTemplate = stringValue(raw.customUrlTemplate, '')
  const engine =
    requestedEngine === 'custom' && !normalizeCustomSearchTemplate(customUrlTemplate)
      ? 'google'
      : requestedEngine

  return {
    engine,
    customName: stringValue(raw.customName, ''),
    customUrlTemplate,
    openMode: raw.openMode === 'new' ? 'new' : 'current',
  }
}

function migrateBackground(value: unknown): BackgroundRef {
  if (!isRecord(value)) return cloneBackground(DEFAULT_SETTINGS.appearance.background)
  if (value.kind === 'local' && typeof value.assetId === 'string' && value.assetId.trim()) {
    return { kind: 'local', assetId: value.assetId }
  }
  if (value.kind === 'remote' && typeof value.url === 'string') {
    try {
      const url = new URL(value.url)
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) {
        return { kind: 'remote', url: url.href }
      }
    } catch {
      // Invalid legacy URLs migrate to the bundled default.
    }
  }
  if (
    value.kind === 'bundled' &&
    typeof value.id === 'string' &&
    value.id.trim() &&
    typeof value.src === 'string' &&
    value.src.startsWith('/')
  ) {
    return { kind: 'bundled', id: value.id, src: value.src }
  }
  return cloneBackground(DEFAULT_SETTINGS.appearance.background)
}

function migrateAppearance(value: unknown, isVersionTwo: boolean): AppearanceSettings {
  const raw = isRecord(value) ? value : {}
  const defaults = DEFAULT_SETTINGS.appearance
  const accent =
    typeof raw.accent === 'string' && /^#[\da-f]{6}$/iu.test(raw.accent)
      ? raw.accent
      : defaults.accent

  return {
    background: migrateBackground(raw.background),
    overlay: finiteNumber(raw.overlay, defaults.overlay, 0, 85),
    brightness: finiteNumber(raw.brightness, defaults.brightness, 40, 140),
    blur: finiteNumber(raw.blur, defaults.blur, 0, 24),
    focalX: finiteNumber(raw.focalX, defaults.focalX, 0, 100),
    focalY: finiteNumber(raw.focalY, defaults.focalY, 0, 100),
    accent,
    contentOpacity: finiteNumber(raw.contentOpacity, defaults.contentOpacity, 0, 100),
    contentBlur: finiteNumber(
      isVersionTwo ? raw.contentBlur : undefined,
      defaults.contentBlur,
      0,
      24,
    ),
    bookmarkLayout: raw.bookmarkLayout === 'icon' ? 'icon' : 'detail',
    bookmarkCardOpacity: finiteNumber(
      isVersionTwo ? raw.bookmarkCardOpacity : undefined,
      defaults.bookmarkCardOpacity,
      0,
      100,
    ),
    bookmarkDetailCardRadius: finiteNumber(
      isVersionTwo ? raw.bookmarkDetailCardRadius : undefined,
      defaults.bookmarkDetailCardRadius,
      0,
      24,
    ),
    bookmarkIconCardRadius: finiteNumber(
      isVersionTwo ? raw.bookmarkIconCardRadius : raw.bookmarkIconRadius,
      defaults.bookmarkIconCardRadius,
      0,
      50,
    ),
  }
}

export function migrateSettings(value: unknown): UserSettingsV2 {
  assertSupportedSettingsVersion(value)
  const raw = isRecord(value) ? value : {}
  const isVersionTwo = raw.schemaVersion === CURRENT_SETTINGS_SCHEMA_VERSION
  const customCss = isRecord(raw.customCss) ? raw.customCss : {}
  const code = stringValue(customCss.code, '')
  const codeWithinLimit = new TextEncoder().encode(code).byteLength <= MAX_CUSTOM_CSS_BYTES
  const migratedCode = codeWithinLimit ? code : ''
  const cssIsSafe = passesCustomCssPrivacyBoundary(migratedCode)

  return {
    schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    displayedFolders: migrateDisplayedFolders(raw.displayedFolders),
    search: migrateSearch(raw.search),
    appearance: migrateAppearance(raw.appearance, isVersionTwo),
    customCss: {
      enabled: customCss.enabled === true && cssIsSafe,
      code: migratedCode,
    },
  }
}

function hasSameValue(left: unknown, right: UserSettingsV2): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export class SettingsService {
  private readonly storageArea: StorageAreaPort
  private readonly storageChanges: StorageChangesPort

  constructor(options: SettingsServiceOptions = {}) {
    this.storageArea = options.storageArea ?? browser.storage.local
    this.storageChanges = options.storageChanges ?? browser.storage.onChanged
  }

  async load(): Promise<UserSettingsV2> {
    const stored = (await this.storageArea.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]
    const settings = migrateSettings(stored)
    if (!hasSameValue(stored, settings)) {
      await this.storageArea.set({ [SETTINGS_STORAGE_KEY]: settings })
    }
    return cloneSettings(settings)
  }

  async save(value: UserSettingsV2): Promise<UserSettingsV2> {
    const settings = migrateSettings(value)
    await this.storageArea.set({ [SETTINGS_STORAGE_KEY]: settings })
    return cloneSettings(settings)
  }

  subscribe(listener: SettingsListener, onError?: SettingsErrorListener): () => void {
    const onChanged = (changes: Record<string, StorageChangeValue>, areaName: string): void => {
      if (areaName !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) return
      try {
        listener(migrateSettings(changes[SETTINGS_STORAGE_KEY]?.newValue))
      } catch (cause) {
        onError?.(toError(cause))
      }
    }
    this.storageChanges.addListener(onChanged)
    return () => this.storageChanges.removeListener(onChanged)
  }
}

export const settingsService = new SettingsService()
