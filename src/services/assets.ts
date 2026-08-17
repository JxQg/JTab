import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_LOCAL_IMAGE_DIMENSION = 8192
export const MAX_BACKGROUND_DIMENSION = 3840
export const MAX_ICON_DIMENSION = 128

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type LocalAssetKind = 'background' | 'bookmark-icon'

export interface StoredImageAsset {
  id: string
  kind: LocalAssetKind
  blob: Blob
  width: number
  height: number
  createdAt: number
  originalName: string
}

export interface StoredBookmarkIcon extends StoredImageAsset {
  kind: 'bookmark-icon'
  bookmarkId: string
}

export interface ProcessedImage {
  blob: Blob
  width: number
  height: number
}

interface JTabAssetDatabase extends DBSchema {
  backgrounds: {
    key: string
    value: StoredImageAsset
  }
  bookmarkIcons: {
    key: string
    value: StoredBookmarkIcon
  }
}

export class LocalImageValidationError extends Error {
  constructor(
    public readonly code:
      | 'unsupported_type'
      | 'file_too_large'
      | 'invalid_dimensions'
      | 'dimensions_too_large'
      | 'decode_failed'
      | 'encode_failed',
    message: string,
  ) {
    super(message)
    this.name = 'LocalImageValidationError'
  }
}

export class RemoteBackgroundValidationError extends Error {
  constructor(
    public readonly code: 'invalid_url' | 'load_failed' | 'timeout',
    message: string,
  ) {
    super(message)
    this.name = 'RemoteBackgroundValidationError'
  }
}

export function validateLocalImageFile(file: File): void {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type.toLocaleLowerCase())) {
    throw new LocalImageValidationError('unsupported_type', '仅支持 JPEG、PNG 或 WebP 位图。')
  }
  if (file.size <= 0 || file.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageValidationError('file_too_large', '图片大小必须在 20 MB 以内。')
  }
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close(): void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch (error) {
      throw new LocalImageValidationError(
        'decode_failed',
        error instanceof Error ? error.message : '无法读取图片。',
      )
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(objectUrl),
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new LocalImageValidationError('decode_failed', '无法读取图片。'))
    }
    image.src = objectUrl
  })
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== 'image/webp') {
          reject(new LocalImageValidationError('encode_failed', '浏览器无法生成 WebP 图片。'))
          return
        }
        resolve(blob)
      },
      'image/webp',
      quality,
    )
  })
}

export async function processLocalImage(
  file: File,
  maximumOutputDimension: number,
): Promise<ProcessedImage> {
  validateLocalImageFile(file)
  const decoded = await decodeImage(file)
  try {
    if (decoded.width <= 0 || decoded.height <= 0) {
      throw new LocalImageValidationError('invalid_dimensions', '图片尺寸无效。')
    }
    if (decoded.width > MAX_LOCAL_IMAGE_DIMENSION || decoded.height > MAX_LOCAL_IMAGE_DIMENSION) {
      throw new LocalImageValidationError('dimensions_too_large', '图片宽高不能超过 8192 像素。')
    }

    const scale = Math.min(1, maximumOutputDimension / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) {
      throw new LocalImageValidationError('encode_failed', '无法创建图片处理画布。')
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, 0, 0, width, height)
    const blob = await canvasToWebp(canvas, maximumOutputDimension <= 128 ? 0.94 : 0.9)
    return { blob, width, height }
  } finally {
    decoded.close()
  }
}

function randomAssetId(prefix: string): string {
  const value =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${value}`
}

export class LocalAssetRepository {
  private databasePromise: Promise<IDBPDatabase<JTabAssetDatabase>> | null = null

  constructor(private readonly databaseName = 'jtab-assets') {}

  private getDatabase(): Promise<IDBPDatabase<JTabAssetDatabase>> {
    this.databasePromise ??= openDB<JTabAssetDatabase>(this.databaseName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('backgrounds')) {
          database.createObjectStore('backgrounds', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('bookmarkIcons')) {
          database.createObjectStore('bookmarkIcons', { keyPath: 'bookmarkId' })
        }
      },
    })
    return this.databasePromise
  }

  async saveBackground(file: File): Promise<StoredImageAsset> {
    const processed = await processLocalImage(file, MAX_BACKGROUND_DIMENSION)
    const asset: StoredImageAsset = {
      id: randomAssetId('background'),
      kind: 'background',
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
      createdAt: Date.now(),
      originalName: file.name,
    }
    await (await this.getDatabase()).put('backgrounds', asset)
    return asset
  }

  async getBackground(assetId: string): Promise<StoredImageAsset | undefined> {
    return (await this.getDatabase()).get('backgrounds', assetId)
  }

  async deleteBackground(assetId: string): Promise<void> {
    await (await this.getDatabase()).delete('backgrounds', assetId)
  }

  async saveBookmarkIcon(bookmarkId: string, file: File): Promise<StoredBookmarkIcon> {
    if (!bookmarkId) throw new Error('Bookmark ID must not be empty.')
    const processed = await processLocalImage(file, MAX_ICON_DIMENSION)
    const asset: StoredBookmarkIcon = {
      id: randomAssetId('bookmark-icon'),
      bookmarkId,
      kind: 'bookmark-icon',
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
      createdAt: Date.now(),
      originalName: file.name,
    }
    await (await this.getDatabase()).put('bookmarkIcons', asset)
    return asset
  }

  async getBookmarkIcon(bookmarkId: string): Promise<StoredBookmarkIcon | undefined> {
    return (await this.getDatabase()).get('bookmarkIcons', bookmarkId)
  }

  async deleteBookmarkIcon(bookmarkId: string): Promise<void> {
    await (await this.getDatabase()).delete('bookmarkIcons', bookmarkId)
  }
}

interface RemoteImagePort {
  decoding: 'async' | 'auto' | 'sync'
  referrerPolicy: string
  onload: (() => void) | null
  onerror: (() => void) | null
  src: string
}

export function validateRemoteBackgroundUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new RemoteBackgroundValidationError('invalid_url', '请输入完整的 HTTPS 图片地址。')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href.length > 2048
  ) {
    throw new RemoteBackgroundValidationError('invalid_url', '仅允许无凭据的 HTTPS 图片地址。')
  }
  return url.href
}

export function preloadRemoteBackground(
  value: string,
  options: {
    timeoutMs?: number
    createImage?: () => RemoteImagePort
  } = {},
): Promise<string> {
  const url = validateRemoteBackgroundUrl(value)
  const timeoutMs = options.timeoutMs ?? 12_000
  const image = options.createImage?.() ?? new Image()
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      result()
    }
    const timer = setTimeout(
      () =>
        finish(() => reject(new RemoteBackgroundValidationError('timeout', '远程图片加载超时。'))),
      timeoutMs,
    )
    image.onload = () => finish(() => resolve(url))
    image.onerror = () =>
      finish(() => reject(new RemoteBackgroundValidationError('load_failed', '远程图片无法加载。')))
    image.src = url
  })
}

export const localAssetRepository = new LocalAssetRepository()
