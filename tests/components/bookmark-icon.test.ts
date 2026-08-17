import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BookmarkIcon from '../../entrypoints/newtab/components/BookmarkIcon.vue'
import type { StoredBookmarkIcon } from '../../src/services/assets'

const getBookmarkIconMock = vi.hoisted(() =>
  vi.fn<(bookmarkId: string) => Promise<StoredBookmarkIcon | undefined>>(),
)

vi.mock('../../src/services/assets', () => ({
  localAssetRepository: {
    getBookmarkIcon: getBookmarkIconMock,
  },
}))

function faviconResponse(bytes: number[]): Response {
  return new Response(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }), { status: 200 })
}

describe('BookmarkIcon', () => {
  beforeEach(() => {
    getBookmarkIconMock.mockReset()
    getBookmarkIconMock.mockResolvedValue(undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:jtab-test-icon')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses a text monogram when Chromium returns its generic favicon', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toMatch(/^\/_favicon\//u)
      return faviconResponse([1, 2, 3, 4])
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookmarkIcon, {
      props: {
        bookmarkId: 'bookmark-generic',
        title: 'Example',
        url: 'https://example.com/',
        size: 36,
      },
    })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=36',
      '/_favicon/?pageUrl=https%3A%2F%2Fjtab.invalid%2F&size=36',
    ])
    expect(fetchMock.mock.calls.every(([input]) => !/^https?:/u.test(String(input)))).toBe(true)
    expect(wrapper.attributes('data-jtab-icon-source')).toBe('text')
    expect(wrapper.find('.bookmark-icon__text').text()).toBe('E')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('uses a real Chromium cache hit when it differs from the generic favicon', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      faviconResponse(String(input).includes('jtab.invalid') ? [1, 2, 3] : [7, 8, 9]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookmarkIcon, {
      props: {
        bookmarkId: 'bookmark-cached',
        title: 'Cached',
        url: 'https://cached.example/',
        size: 40,
      },
    })
    await flushPromises()

    expect(wrapper.attributes('data-jtab-icon-source')).toBe('browser')
    expect(wrapper.get('img').attributes('src')).toBe('blob:jtab-test-icon')
  })

  it('prefers a local override without requesting a browser favicon', async () => {
    const localIcon: StoredBookmarkIcon = {
      id: 'bookmark-icon:local',
      bookmarkId: 'bookmark-local',
      kind: 'bookmark-icon',
      blob: new Blob([Uint8Array.from([9])], { type: 'image/webp' }),
      width: 64,
      height: 64,
      createdAt: 1,
      originalName: 'local.webp',
    }
    getBookmarkIconMock.mockResolvedValue(localIcon)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookmarkIcon, {
      props: {
        bookmarkId: 'bookmark-local',
        title: 'Local',
        url: 'https://local.example/',
      },
    })
    await flushPromises()

    expect(getBookmarkIconMock).toHaveBeenCalledWith('bookmark-local')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.attributes('data-jtab-icon-source')).toBe('local')
  })

  it('uses the text fallback in Firefox without requesting a favicon', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    )
    vi.resetModules()
    const { default: FirefoxBookmarkIcon } =
      await import('../../entrypoints/newtab/components/BookmarkIcon.vue')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(FirefoxBookmarkIcon, {
      props: {
        bookmarkId: 'bookmark-firefox',
        title: 'Firefox',
        url: 'https://firefox.example/',
      },
    })
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.attributes('data-jtab-icon-source')).toBe('text')
    expect(wrapper.find('.bookmark-icon__text').text()).toBe('F')
  })
})
