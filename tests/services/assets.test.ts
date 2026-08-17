import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LocalAssetRepository,
  LocalImageValidationError,
  MAX_BACKGROUND_DIMENSION,
  RemoteBackgroundValidationError,
  preloadRemoteBackground,
  processLocalImage,
  validateLocalImageFile,
  validateRemoteBackgroundUrl,
} from '../../src/services/assets'

interface FakeBitmap {
  width: number
  height: number
  close: ReturnType<typeof vi.fn>
}

let bitmap: FakeBitmap
let canvasWidth = 0
let canvasHeight = 0
let createElementSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  bitmap = { width: 4000, height: 2000, close: vi.fn() }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  )
  const originalCreateElement = document.createElement.bind(document)
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName !== 'canvas') return originalCreateElement(tagName)
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
      })),
      toBlob(callback: BlobCallback) {
        canvasWidth = this.width
        canvasHeight = this.height
        callback(new Blob(['webp'], { type: 'image/webp' }))
      },
    }
    return canvas as unknown as HTMLCanvasElement
  })
})

afterEach(() => {
  createElementSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('local image processing', () => {
  it('rejects unsupported and oversized files before decoding', () => {
    expect(() =>
      validateLocalImageFile(new File(['svg'], 'icon.svg', { type: 'image/svg+xml' })),
    ).toThrow(LocalImageValidationError)
    expect(() => validateLocalImageFile(new File([], 'empty.png', { type: 'image/png' }))).toThrow(
      LocalImageValidationError,
    )
  })

  it('downscales backgrounds to a 3840px maximum edge and emits WebP', async () => {
    const result = await processLocalImage(
      new File(['pixels'], 'background.png', { type: 'image/png' }),
      MAX_BACKGROUND_DIMENSION,
    )

    expect(result).toMatchObject({ width: 3840, height: 1920 })
    expect(result.blob.type).toBe('image/webp')
    expect(canvasWidth).toBe(3840)
    expect(canvasHeight).toBe(1920)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('rejects decoded dimensions above 8192px', async () => {
    bitmap.width = 9000

    await expect(
      processLocalImage(new File(['pixels'], 'huge.png', { type: 'image/png' }), 3840),
    ).rejects.toMatchObject({ code: 'dimensions_too_large' })
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('persists backgrounds and bookmark icons in separate IndexedDB stores', async () => {
    const repository = new LocalAssetRepository(`jtab-assets-test-${crypto.randomUUID()}`)
    const background = await repository.saveBackground(
      new File(['pixels'], 'background.png', { type: 'image/png' }),
    )
    const icon = await repository.saveBookmarkIcon(
      'bookmark____opaque',
      new File(['pixels'], 'icon.png', { type: 'image/png' }),
    )

    expect((await repository.getBackground(background.id))?.kind).toBe('background')
    expect((await repository.getBookmarkIcon('bookmark____opaque'))?.id).toBe(icon.id)
    expect(canvasWidth).toBe(128)
    expect(canvasHeight).toBe(64)

    await repository.deleteBackground(background.id)
    await repository.deleteBookmarkIcon('bookmark____opaque')
    expect(await repository.getBackground(background.id)).toBeUndefined()
    expect(await repository.getBookmarkIcon('bookmark____opaque')).toBeUndefined()
  })
})

describe('remote background validation', () => {
  it.each([
    'http://images.example.test/a.webp',
    '//images.example.test/a.webp',
    'https://user:secret@images.example.test/a.webp',
    'not a URL',
  ])('rejects non-compliant URLs: %s', (url) => {
    expect(() => validateRemoteBackgroundUrl(url)).toThrow(RemoteBackgroundValidationError)
  })

  it('preloads an HTTPS image without a referrer before accepting it', async () => {
    const fakeImage = {
      decoding: 'auto' as const,
      referrerPolicy: '',
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      _src: '',
      set src(value: string) {
        this._src = value
        queueMicrotask(() => this.onload?.())
      },
      get src() {
        return this._src
      },
    }

    await expect(
      preloadRemoteBackground('https://images.example.test/a.webp', {
        createImage: () => fakeImage,
      }),
    ).resolves.toBe('https://images.example.test/a.webp')
    expect(fakeImage.referrerPolicy).toBe('no-referrer')
  })
})
