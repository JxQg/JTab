import type { UserSettingsV2 } from './types'

export const DEFAULT_SETTINGS: UserSettingsV2 = {
  schemaVersion: 2,
  displayedFolders: [],
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
    overlay: 42,
    brightness: 88,
    blur: 0,
    focalX: 50,
    focalY: 50,
    accent: '#44c2a5',
    contentOpacity: 82,
    contentBlur: 0,
    bookmarkLayout: 'detail',
    bookmarkCardOpacity: 80,
    bookmarkDetailCardRadius: 8,
    bookmarkIconCardRadius: 24,
  },
  customCss: {
    enabled: false,
    code: '',
  },
}

export const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  baidu: 'https://www.baidu.com/s?wd=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
} as const
