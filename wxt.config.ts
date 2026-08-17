import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifestVersion: 3,
  zip: {
    name: 'jtab',
    excludeSources: [
      '.agents/**',
      '.cache/**',
      '.codex/**',
      '.git/**',
      '.output/**',
      '.wxt/**',
      '小舒同学 - 基于书签的新标签页 3.0.2/**',
      'node_modules/**',
      'output/**',
      '.pnpm-store/**',
      'artifacts/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'tests/**',
    ],
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    permissions:
      browser === 'firefox' ? ['bookmarks', 'storage'] : ['bookmarks', 'storage', 'favicon'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      96: 'icons/icon-96.png',
      128: 'icons/icon-128.png',
    },
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'jtab@jxqg.github.io',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
            gecko_android: {
              strict_min_version: '142.0',
            },
          }
        : undefined,
  }),
})
