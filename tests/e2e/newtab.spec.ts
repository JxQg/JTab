import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
} from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { env } from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const extensionPath = path.join(projectRoot, '.output', 'chrome-mv3')
const screenshotDirectory = path.join(projectRoot, 'artifacts', 'screenshots')
const supportedBrowserChannels = ['chromium', 'chrome', 'msedge'] as const
const browserChannel =
  supportedBrowserChannels.find((channel) => channel === env.JTAB_BROWSER_CHANNEL) ?? 'chromium'
const screenshotChannelSuffix = browserChannel === 'chromium' ? '' : `-${browserChannel}`
const viewportSizes = [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const

interface SeededBookmarks {
  primaryFolderId: string
  secondaryFolderId: string
}

interface ExtensionBookmarkNode {
  id: string
  title: string
  url?: string
  unmodifiable?: string
  children?: ExtensionBookmarkNode[]
}

interface ExtensionChromeApi {
  bookmarks: {
    getTree(): Promise<ExtensionBookmarkNode[]>
    create(details: {
      parentId: string
      title: string
      url?: string
    }): Promise<ExtensionBookmarkNode>
  }
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>
      set(values: Record<string, unknown>): Promise<void>
    }
  }
}

async function setRangeControl(frame: Frame, label: string, value: number): Promise<void> {
  const input = frame.locator('.range-control').filter({ hasText: label }).locator('input')
  await input.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Range control is not an input.')
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, String(value))
}

async function findExtensionId(page: Page): Promise<string> {
  await page.goto('chrome://extensions/')
  await page.waitForTimeout(500)
  return page.evaluate(() => {
    const manager = document.querySelector('extensions-manager')
    const itemList = manager?.shadowRoot?.querySelector('extensions-item-list')
    const item = itemList?.shadowRoot?.querySelector('extensions-item')
    return item?.getAttribute('id') ?? ''
  })
}

async function ensureExtensionLoaded(context: BrowserContext, page: Page): Promise<string> {
  const existingId = await findExtensionId(page)
  if (existingId) return existingId

  const browser = context.browser()
  if (!browser) throw new Error('The Chromium browser instance is unavailable.')
  const session = await browser.newBrowserCDPSession()
  try {
    const { id } = await session.send('Extensions.loadUnpacked', { path: extensionPath })
    const { extensions } = await session.send('Extensions.getExtensions')
    const loaded = extensions.find((extension) => extension.id === id)
    if (!id || !loaded?.enabled) {
      throw new Error(
        `CDP loaded JTab but did not enable it: ${JSON.stringify({ returnedId: id, loaded, extensions })}`,
      )
    }
    return id
  } finally {
    await session.detach()
  }
}

async function seedBookmarks(page: Page): Promise<SeededBookmarks> {
  return page.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: ExtensionChromeApi }
    const roots = await chrome.bookmarks.getTree()
    const writableRoot = roots
      .flatMap((root) => root.children ?? [])
      .find((node) => !node.url && !node.unmodifiable)
    if (!writableRoot) throw new Error('No writable browser bookmark root was found.')

    const primary = await chrome.bookmarks.create({ parentId: writableRoot.id, title: '常用收藏' })
    const design = await chrome.bookmarks.create({ parentId: primary.id, title: '设计资源' })
    const systems = await chrome.bookmarks.create({ parentId: design.id, title: '设计系统' })
    await chrome.bookmarks.create({
      parentId: systems.id,
      title: 'Material Design',
      url: 'https://m3.material.io/',
    })
    await chrome.bookmarks.create({
      parentId: systems.id,
      title: 'Carbon Design System',
      url: 'https://carbondesignsystem.com/',
    })
    const engineering = await chrome.bookmarks.create({ parentId: primary.id, title: '工程开发' })
    await chrome.bookmarks.create({
      parentId: engineering.id,
      title: 'GitHub',
      url: 'https://github.com/',
    })
    await chrome.bookmarks.create({
      parentId: engineering.id,
      title: 'Vue.js',
      url: 'https://vuejs.org/',
    })
    await chrome.bookmarks.create({
      parentId: engineering.id,
      title: 'MDN Web Docs',
      url: 'https://developer.mozilla.org/',
    })
    await chrome.bookmarks.create({
      parentId: primary.id,
      title: '少数派',
      url: 'https://sspai.com/',
    })
    await chrome.bookmarks.create({
      parentId: primary.id,
      title: 'Notion 工作台',
      url: 'https://www.notion.so/',
    })
    await chrome.bookmarks.create({
      parentId: primary.id,
      title: 'Linear',
      url: 'https://linear.app/',
    })

    const secondary = await chrome.bookmarks.create({
      parentId: writableRoot.id,
      title: '阅读与研究',
    })
    await chrome.bookmarks.create({
      parentId: secondary.id,
      title: 'arXiv',
      url: 'https://arxiv.org/',
    })
    await chrome.bookmarks.create({
      parentId: secondary.id,
      title: 'Wikipedia',
      url: 'https://www.wikipedia.org/',
    })

    return { primaryFolderId: primary.id, secondaryFolderId: secondary.id }
  })
}

async function configureJTab(page: Page, folders: SeededBookmarks): Promise<void> {
  await page.evaluate(async ({ primaryFolderId, secondaryFolderId }) => {
    const { chrome } = globalThis as unknown as { chrome: ExtensionChromeApi }
    await chrome.storage.local.set({
      'jtab.settings': {
        schemaVersion: 1,
        displayedFolders: [
          { folderId: primaryFolderId, scope: 'subtree', order: 0 },
          { folderId: secondaryFolderId, scope: 'direct', order: 1 },
        ],
        search: {
          engine: 'google',
          customName: '',
          customUrlTemplate: '',
          openMode: 'current',
        },
        appearance: {
          background: {
            kind: 'bundled',
            id: 'quiet-tide',
            src: '/wallpapers/quiet-tide.webp',
          },
          overlay: 40,
          brightness: 88,
          blur: 0,
          focalX: 50,
          focalY: 50,
          accent: '#16866f',
          contentOpacity: 82,
          bookmarkLayout: 'detail',
          bookmarkIconRadius: 24,
        },
        customCss: { enabled: false, code: '' },
      },
    })
  }, folders)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '常用收藏' })).toBeVisible()
}

async function setStoredCustomCss(page: Page, code: string, enabled: boolean): Promise<void> {
  await page.evaluate(
    async ({ cssCode, cssEnabled }) => {
      const { chrome } = globalThis as unknown as { chrome: ExtensionChromeApi }
      const stored = await chrome.storage.local.get('jtab.settings')
      const settings = stored['jtab.settings']
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        throw new Error('JTab settings are unavailable.')
      }
      await chrome.storage.local.set({
        'jtab.settings': {
          ...settings,
          customCss: { code: cssCode, enabled: cssEnabled },
        },
      })
    },
    { cssCode: code, cssEnabled: enabled },
  )
}

async function assertNewTabLayout(page: Page, width: number, height: number): Promise<void> {
  const result = await page.evaluate(() => {
    const topbarItems = ['.brand', '.search-wrap', '.topbar__actions']
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => Boolean(rect))
    const overlaps: Array<[number, number]> = []
    for (let left = 0; left < topbarItems.length; left += 1) {
      for (let right = left + 1; right < topbarItems.length; right += 1) {
        const a = topbarItems[left]
        const b = topbarItems[right]
        if (!a || !b) continue
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 2 && height > 2) overlaps.push([left, right])
      }
    }
    const background = document.querySelector<HTMLImageElement>('[data-jtab-role="background"]')
    return {
      viewport: [window.innerWidth, window.innerHeight],
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      overlaps,
      backgroundLoaded: Boolean(background?.complete && background.naturalWidth > 0),
    }
  })
  expect(result.viewport).toEqual([width, height])
  expect(result.horizontalOverflow).toBeLessThanOrEqual(1)
  expect(result.overlaps).toEqual([])
  expect(result.backgroundLoaded).toBe(true)
}

async function assertOptionsLayout(frame: Frame): Promise<void> {
  const result = await frame.evaluate(() => {
    const overlap = (left: DOMRect | undefined, right: DOMRect | undefined): boolean => {
      if (!left || !right) return false
      return (
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > 2 &&
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 2
      )
    }
    const brand = document.querySelector('.brand-block')?.getBoundingClientRect()
    const saveState = document.querySelector('.save-state')?.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
    const main = document.querySelector('.settings-content')?.getBoundingClientRect()
    const activeHeading = document
      .querySelector('[data-jtab-role="appearance-bookmarks"] .section-heading')
      ?.getBoundingClientRect()
    const navigationButtons = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar nav button'),
    ).map((button, index) => {
      const bounds = button.getBoundingClientRect()
      return {
        index,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      }
    })
    const navigationOutOfViewport = navigationButtons
      .filter((button) => button.left < -1 || button.right > window.innerWidth + 1)
      .map((button) => button.index)
    const navigationOverlaps: Array<[number, number]> = []
    for (let left = 0; left < navigationButtons.length; left += 1) {
      for (let right = left + 1; right < navigationButtons.length; right += 1) {
        const first = navigationButtons[left]
        const second = navigationButtons[right]
        if (!first || !second) continue
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
        if (width > 2 && height > 2) navigationOverlaps.push([left, right])
      }
    }
    const stacked = window.innerWidth <= 840
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      topbarOverlap: overlap(brand, saveState),
      workbenchOverlap: !stacked && overlap(sidebar, main),
      stickyNavigationOverlap:
        stacked && sidebar && activeHeading ? activeHeading.top < sidebar.bottom - 2 : false,
      navigationOutOfViewport,
      navigationOverlaps,
    }
  })
  expect(result.horizontalOverflow).toBeLessThanOrEqual(1)
  expect(result.topbarOverlap).toBe(false)
  expect(result.workbenchOverlap).toBe(false)
  expect(result.stickyNavigationOverlap).toBe(false)
  expect(result.navigationOutOfViewport).toEqual([])
  expect(result.navigationOverlaps).toEqual([])
}

test('Fluid new tab supports private bookmark browsing, management, and target viewports', async () => {
  test.setTimeout(90_000)
  await mkdir(screenshotDirectory, { recursive: true })
  const context = await chromium.launchPersistentContext('', {
    channel: browserChannel,
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    const extensionId = await ensureExtensionLoaded(context, page)
    const outboundRequests: string[] = []
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url())) outboundRequests.push(request.url())
    })
    const extensionNewTabUrl = `chrome-extension://${extensionId}/newtab.html`
    await page.goto(browserChannel === 'chromium' ? extensionNewTabUrl : 'chrome://newtab/', {
      waitUntil: 'domcontentloaded',
    })
    await expect.poll(() => page.url()).toBe(extensionNewTabUrl)
    const folders = await seedBookmarks(page)

    const emptySettingsTrigger = page
      .locator('.state-panel--setup')
      .getByRole('button', { name: '打开设置' })
    await emptySettingsTrigger.click()
    const emptySettingsFrameElement = page.locator('iframe[title="JTab 设置"]')
    await expect(emptySettingsFrameElement).toBeVisible()
    const emptySettingsFrame = page.frames().find((frame) => frame.url().includes('/options.html'))
    if (!emptySettingsFrame) throw new Error('The empty-state settings frame did not load.')
    await emptySettingsFrame.getByRole('checkbox', { name: /常用收藏/u }).click()
    await expect(emptySettingsTrigger).toBeHidden()
    await page.getByRole('button', { name: '关闭设置' }).click()
    await expect(
      page.locator('.topbar__actions').getByRole('button', { name: '打开设置' }),
    ).toBeFocused()

    await configureJTab(page, folders)
    const migratedSettings = await page.evaluate(async () => {
      const { chrome } = globalThis as unknown as { chrome: ExtensionChromeApi }
      return (await chrome.storage.local.get('jtab.settings'))['jtab.settings']
    })
    expect(migratedSettings).toMatchObject({
      schemaVersion: 2,
      appearance: {
        contentBlur: 0,
        bookmarkCardOpacity: 80,
        bookmarkDetailCardRadius: 8,
        bookmarkIconCardRadius: 24,
      },
    })

    const brandLayout = await page.locator('.topbar__brand').evaluate((element) => {
      const logo = element.querySelector<HTMLElement>('[data-jtab-role="brand-logo"]')
      const menu = element.querySelector<HTMLElement>('[data-jtab-role="folder-menu"]')
      const logoBounds = logo?.getBoundingClientRect()
      const menuBounds = menu?.getBoundingClientRect()
      const logoImage = logo instanceof HTMLImageElement ? logo : null
      return {
        logoLoaded: Boolean(logoImage?.complete && logoImage.naturalWidth > 0),
        menuAfterLogo: Boolean(logoBounds && menuBounds && menuBounds.left > logoBounds.right),
        menuSize: menuBounds ? [menuBounds.width, menuBounds.height] : [],
      }
    })
    expect(brandLayout).toEqual({ logoLoaded: true, menuAfterLogo: true, menuSize: [38, 38] })
    await expect(page.locator('[data-jtab-role="folder-menu"]')).toHaveAttribute(
      'aria-label',
      '打开文件夹树',
    )
    await expect(page.locator('.bookmark-icon__loading')).toHaveCount(0)
    await expect(
      page.locator('[data-jtab-role="bookmark-icon"][data-jtab-icon-source="text"]'),
    ).toHaveCount(3)

    const shell = page.locator('.jtab-shell')
    const readCssVariableContract = () =>
      shell.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          publicContentOpacity: style.getPropertyValue('--jtab-content-opacity').trim(),
          publicContentBlur: style.getPropertyValue('--jtab-content-blur').trim(),
          publicBookmarkOpacity: style.getPropertyValue('--jtab-bookmark-card-opacity').trim(),
          publicDetailRadius: style.getPropertyValue('--jtab-bookmark-detail-card-radius').trim(),
          publicIconRadius: style.getPropertyValue('--jtab-bookmark-icon-radius').trim(),
          settingContentOpacity: style.getPropertyValue('--jtab-setting-content-opacity').trim(),
          settingContentBlur: style.getPropertyValue('--jtab-setting-content-blur').trim(),
          settingBookmarkOpacity: style
            .getPropertyValue('--jtab-setting-bookmark-card-opacity')
            .trim(),
          settingDetailRadius: style
            .getPropertyValue('--jtab-setting-bookmark-detail-card-radius')
            .trim(),
          settingIconRadius: style.getPropertyValue('--jtab-setting-bookmark-icon-radius').trim(),
        }
      })

    await expect.poll(readCssVariableContract).toEqual({
      publicContentOpacity: '0.82',
      publicContentBlur: '0px',
      publicBookmarkOpacity: '0.8',
      publicDetailRadius: '8px',
      publicIconRadius: '18%',
      settingContentOpacity: '0.82',
      settingContentBlur: '0px',
      settingBookmarkOpacity: '0.8',
      settingDetailRadius: '8px',
      settingIconRadius: '18%',
    })

    await setStoredCustomCss(
      page,
      `.jtab-shell {
  --jtab-content-opacity: 0.37;
  --jtab-content-blur: 9px;
  --jtab-bookmark-card-opacity: 0;
  --jtab-bookmark-detail-card-radius: 13px;
  --jtab-bookmark-icon-radius: 31%;
}`,
      true,
    )
    await expect.poll(readCssVariableContract).toEqual({
      publicContentOpacity: '0.37',
      publicContentBlur: '9px',
      publicBookmarkOpacity: '0',
      publicDetailRadius: '13px',
      publicIconRadius: '31%',
      settingContentOpacity: '0.82',
      settingContentBlur: '0px',
      settingBookmarkOpacity: '0.8',
      settingDetailRadius: '8px',
      settingIconRadius: '18%',
    })

    await expect
      .poll(() =>
        page
          .locator('.content-section')
          .evaluate((element) => getComputedStyle(element).backdropFilter),
      )
      .toBe('blur(9px)')
    const customCssBookmark = page.locator('.content-tile--bookmark').first()
    await customCssBookmark.hover()
    await expect
      .poll(() =>
        customCssBookmark.evaluate((element) => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, shadow: style.boxShadow }
        }),
      )
      .toEqual({
        background: 'rgba(255, 255, 255, 0)',
        shadow: 'rgba(13, 34, 28, 0) 0px 9px 22px 0px',
      })

    await setStoredCustomCss(page, '', false)
    await expect.poll(readCssVariableContract).toEqual({
      publicContentOpacity: '0.82',
      publicContentBlur: '0px',
      publicBookmarkOpacity: '0.8',
      publicDetailRadius: '8px',
      publicIconRadius: '18%',
      settingContentOpacity: '0.82',
      settingContentBlur: '0px',
      settingBookmarkOpacity: '0.8',
      settingDetailRadius: '8px',
      settingIconRadius: '18%',
    })

    for (const viewport of viewportSizes) {
      await page.setViewportSize(viewport)
      await assertNewTabLayout(page, viewport.width, viewport.height)
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `newtab${screenshotChannelSuffix}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
      })
    }

    const search = page.getByRole('searchbox', { name: /搜索已展示的书签/u })
    await search.fill('Vue')
    await search.press('ArrowDown')
    await expect(page.getByRole('option', { name: /Vue\.js/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('button', { name: '清空搜索' }).click()

    const searchEngineSelector = page.getByRole('button', {
      name: /当前搜索引擎：Google/u,
    })
    await searchEngineSelector.focus()
    await searchEngineSelector.press('Enter')
    const googleOption = page.getByRole('menuitemradio', { name: 'Google' })
    const bingOption = page.getByRole('menuitemradio', { name: 'Bing' })
    await expect(googleOption).toBeFocused()
    await googleOption.press('ArrowDown')
    await expect(bingOption).toBeFocused()
    await bingOption.press('Enter')
    await expect(page.getByRole('button', { name: /当前搜索引擎：Bing/u })).toBeVisible()

    await page.evaluate(() => {
      document.documentElement.dataset.jtabOpenCount = '0'
      window.open = ((url?: string | URL) => {
        document.documentElement.dataset.jtabOpenCount = String(
          Number(document.documentElement.dataset.jtabOpenCount ?? '0') + 1,
        )
        document.documentElement.dataset.jtabOpenedUrl = String(url ?? '')
        return null
      }) as typeof window.open
    })
    await search.fill('middle click privacy')
    const webSearchResult = page.getByRole('button', { name: /使用 Bing 搜索/u })
    await webSearchResult.hover()
    await page.mouse.down({ button: 'middle' })
    await page.waitForTimeout(180)
    await page.mouse.up({ button: 'middle' })
    await expect(page.locator('html')).toHaveAttribute('data-jtab-open-count', '1')
    await expect(page.locator('html')).toHaveAttribute(
      'data-jtab-opened-url',
      'https://www.bing.com/search?q=middle%20click%20privacy',
    )
    await page.getByRole('button', { name: '清空搜索' }).click()

    await page.locator('.folder-section__toggle').filter({ hasText: '设计资源' }).click()
    await page.locator('.folder-section__toggle').filter({ hasText: '设计系统' }).click()
    await expect(page.getByRole('link', { name: /Material Design/u })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })
    await assertNewTabLayout(page, 1280, 720)
    await page.screenshot({
      path: path.join(
        screenshotDirectory,
        `newtab-expanded${screenshotChannelSuffix}-1280x720.png`,
      ),
      fullPage: false,
    })

    await page.getByRole('button', { name: '打开文件夹树' }).click()
    await page.locator('.folder-drawer').getByRole('button', { name: '设计系统 2' }).click()
    await expect(page.getByRole('heading', { name: '设计系统' })).toBeVisible()

    await page.getByRole('button', { name: '管理' }).click()
    await page.getByRole('button', { name: '添加书签' }).click()
    await expect(page.getByRole('heading', { name: '添加书签' })).toBeVisible()
    await expect(page.getByLabel('名称')).toBeFocused()

    const settingsTrigger = page.getByRole('button', { name: '打开设置' })
    await settingsTrigger.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement))
        throw new Error('Settings trigger is not a button.')
      element.click()
    })
    await expect(page).toHaveURL(extensionNewTabUrl)
    const settingsFrameElement = page.locator('iframe[title="JTab 设置"]')
    await expect(settingsFrameElement).toBeVisible()
    await expect(page.locator('[data-jtab-component="dialog"]')).toHaveCount(0)
    await expect(page.locator('.workspace')).toHaveAttribute('inert', '')
    let settingsFrame = page.frames().find((frame) => frame.url().includes('/options.html'))
    if (!settingsFrame) throw new Error('The embedded settings frame did not load.')
    await expect(settingsFrame.getByRole('heading', { name: '首页内容' })).toBeVisible()
    const embeddedHomeNavigation = settingsFrame.getByRole('button', { name: /首页内容/u })
    await embeddedHomeNavigation.focus()
    await embeddedHomeNavigation.press('Escape')
    await expect(settingsFrameElement).toBeHidden()
    await expect(settingsTrigger).toBeFocused()

    await settingsTrigger.click()
    await expect(settingsFrameElement).toBeVisible()
    settingsFrame = page.frames().find((frame) => frame.url().includes('/options.html'))
    if (!settingsFrame) throw new Error('The embedded settings frame did not reopen.')
    await expect(settingsFrame.locator('[data-jtab-role="appearance-background"]')).toHaveCount(1)
    await expect(settingsFrame.locator('[data-jtab-role="appearance-collection"]')).toHaveCount(1)
    await expect(settingsFrame.locator('[data-jtab-role="appearance-bookmarks"]')).toHaveCount(1)

    await settingsFrame.getByRole('button', { name: /收藏栏配置/u }).click()
    await setRangeControl(settingsFrame, '收藏栏透明度', 0)
    await setRangeControl(settingsFrame, '收藏栏磨砂', 0)
    await expect
      .poll(() =>
        page.locator('.jtab-shell').evaluate((element) => ({
          opacity: getComputedStyle(element).getPropertyValue('--jtab-content-opacity').trim(),
          blur: getComputedStyle(element).getPropertyValue('--jtab-content-blur').trim(),
        })),
      )
      .toEqual({ opacity: '0', blur: '0px' })

    const transparentContent = await page.locator('.content-section').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        shadow: style.boxShadow,
        backdrop: style.backdropFilter,
        contentTone: element.getAttribute('data-jtab-content-tone'),
        bookmarkTone: element.getAttribute('data-jtab-bookmark-tone'),
      }
    })
    expect(transparentContent).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      border: 'rgba(0, 0, 0, 0)',
      shadow: 'none',
      backdrop: 'blur(0px)',
      contentTone: 'light',
      bookmarkTone: 'dark',
    })

    await setRangeControl(settingsFrame, '收藏栏磨砂', 12)
    await expect
      .poll(() =>
        page
          .locator('.content-section')
          .evaluate((element) => getComputedStyle(element).backdropFilter),
      )
      .toContain('blur(12px)')
    await setRangeControl(settingsFrame, '收藏栏磨砂', 0)

    await settingsFrame.getByRole('button', { name: /书签配置/u }).click()
    await setRangeControl(settingsFrame, '书签底层透明度', 0)
    await setRangeControl(settingsFrame, '详细卡片圆角', 20)
    await setRangeControl(settingsFrame, '图标卡片圆角', 50)
    await settingsFrame.getByRole('button', { name: '单图标' }).click()
    await expect
      .poll(() =>
        page.locator('.jtab-shell').evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            opacity: style.getPropertyValue('--jtab-bookmark-card-opacity').trim(),
            detailRadius: style.getPropertyValue('--jtab-bookmark-detail-card-radius').trim(),
            iconRadius: style.getPropertyValue('--jtab-bookmark-icon-card-radius').trim(),
          }
        }),
      )
      .toEqual({ opacity: '0', detailRadius: '20px', iconRadius: '50%' })
    await expect(page.locator('.content-section')).toHaveAttribute(
      'data-jtab-bookmark-tone',
      'light',
    )

    for (const viewport of viewportSizes) {
      await page.setViewportSize(viewport)
      await settingsFrame.getByRole('button', { name: /书签配置/u }).click()
      await settingsFrame.waitForTimeout(250)
      await assertOptionsLayout(settingsFrame)
      const panelBounds = await page.locator('.settings-panel').evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top }
      })
      expect(panelBounds.width).toBeLessThanOrEqual(1180)
      expect(panelBounds.height).toBeLessThanOrEqual(860)
      expect(panelBounds.left).toBeGreaterThanOrEqual(0)
      expect(panelBounds.top).toBeGreaterThanOrEqual(0)
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `settings${screenshotChannelSuffix}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
      })
    }

    await page.getByRole('button', { name: '关闭设置' }).click()
    await page.locator('.entry-tabs button').filter({ hasText: '常用收藏' }).click()
    await expect(page.locator('.content-tile--folder').first()).toBeVisible()
    const cardSurfaces = await page.evaluate(() => {
      const bookmark = document.querySelector<HTMLElement>('.content-tile--bookmark')
      const folder = document.querySelector<HTMLElement>('.content-tile--folder')
      return {
        bookmarkBackground: bookmark ? getComputedStyle(bookmark).backgroundColor : '',
        bookmarkShadow: bookmark ? getComputedStyle(bookmark).boxShadow : '',
        folderBackground: folder ? getComputedStyle(folder).backgroundColor : '',
      }
    })
    expect(cardSurfaces.bookmarkBackground).toBe('rgba(0, 0, 0, 0)')
    expect(cardSurfaces.bookmarkShadow).toBe('none')
    expect(cardSurfaces.folderBackground).not.toBe('rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: '完成' }).click()
    await expect(page.locator('.jtab-shell')).toHaveClass(/bookmark-layout--icon/u)

    for (const viewport of viewportSizes) {
      await page.setViewportSize(viewport)
      await assertNewTabLayout(page, viewport.width, viewport.height)
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `newtab-icon${screenshotChannelSuffix}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
      })
    }

    const iconTileBounds = await page
      .locator('.bookmark-grid .content-tile--bookmark')
      .first()
      .evaluate((element) => {
        const tile = element.getBoundingClientRect()
        const iconElement = element.querySelector<HTMLElement>('[data-jtab-role="bookmark-icon"]')
        const icon = iconElement?.getBoundingClientRect()
        const title = element.querySelector('.tile-copy')?.getBoundingClientRect()
        return {
          squareDifference: Math.abs(tile.width - tile.height),
          titleBelowIcon: Boolean(icon && title && title.top >= icon.bottom),
          cardRadius: getComputedStyle(element).borderRadius,
          iconRadius: iconElement ? getComputedStyle(iconElement).borderRadius : '',
        }
      })
    expect(iconTileBounds.squareDifference).toBeLessThanOrEqual(1)
    expect(iconTileBounds.titleBelowIcon).toBe(true)
    expect(iconTileBounds.cardRadius).toBe('50%')
    expect(iconTileBounds.iconRadius).toBe('18%')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.jtab-shell')).toHaveClass(/bookmark-layout--icon/u)
    const persistedSettings = await page.evaluate(async () => {
      const { chrome } = globalThis as unknown as { chrome: ExtensionChromeApi }
      return (await chrome.storage.local.get('jtab.settings'))['jtab.settings']
    })
    expect(persistedSettings).toMatchObject({
      schemaVersion: 2,
      appearance: {
        contentOpacity: 0,
        contentBlur: 0,
        bookmarkCardOpacity: 0,
        bookmarkDetailCardRadius: 20,
        bookmarkIconCardRadius: 50,
      },
    })

    expect(outboundRequests).toEqual([])
  } finally {
    await context.close()
  }
})
