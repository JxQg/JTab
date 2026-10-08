<script setup lang="ts">
/* global Blob, URL, fetch, navigator */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  getBookmarkFallbackColor,
  getBookmarkHostname,
  getBookmarkMonogram,
  type BookmarkIconSource,
} from '../../../src/core/icons'
import { localAssetRepository } from '../../../src/services/assets'

const props = withDefaults(
  defineProps<{
    bookmarkId: string
    title: string
    url: string
    size?: number
  }>(),
  { size: 36 },
)

const emit = defineEmits<{
  sourceChange: [source: BookmarkIconSource]
}>()

const IS_FIREFOX = navigator.userAgent.includes('Firefox/')
const defaultFaviconBytes = new Map<number, Promise<Uint8Array | null>>()

interface BrowserFavicon {
  blob: Blob
  bytes: Uint8Array
}

async function fetchBrowserFavicon(url: string): Promise<BrowserFavicon | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return { blob, bytes: new Uint8Array(await blob.arrayBuffer()) }
  } catch {
    return null
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function getDefaultFaviconBytes(size: number): Promise<Uint8Array | null> {
  const cached = defaultFaviconBytes.get(size)
  if (cached) return cached
  const defaultUrl = `/_favicon/?pageUrl=${encodeURIComponent('https://jtab.invalid/')}&size=${size}`
  const request = fetchBrowserFavicon(defaultUrl).then((result) => result?.bytes ?? null)
  defaultFaviconBytes.set(size, request)
  return request
}

const source = ref<BookmarkIconSource>('text')
const loading = ref(true)
const imageUrl = ref('')

const monogram = computed(() => getBookmarkMonogram(props.title, props.url))
const fallbackColor = computed(() => getBookmarkFallbackColor(props.title, props.url))
const sourceLabel = computed(() => {
  if (source.value === 'local') return '图标来源：本地自定义'
  if (source.value === 'browser') return '图标来源：浏览器缓存'
  return '图标来源：文字兜底'
})

function setSource(next: BookmarkIconSource): void {
  source.value = next
  emit('sourceChange', next)
}

function useTextFallback(): void {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
  setSource('text')
}

onMounted(async () => {
  try {
    const localIcon = await localAssetRepository.getBookmarkIcon(props.bookmarkId)
    if (localIcon) {
      imageUrl.value = URL.createObjectURL(localIcon.blob)
      setSource('local')
      return
    }
    if (!IS_FIREFOX) {
      const size = Math.max(16, props.size)
      const nativeUrl = `/_favicon/?pageUrl=${encodeURIComponent(props.url)}&size=${size}`
      const [favicon, fallbackBytes] = await Promise.all([
        fetchBrowserFavicon(nativeUrl),
        getDefaultFaviconBytes(size),
      ])
      if (favicon && fallbackBytes && !sameBytes(favicon.bytes, fallbackBytes)) {
        imageUrl.value = URL.createObjectURL(favicon.blob)
        setSource('browser')
        return
      }
    }
    setSource('text')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})
</script>

<template>
  <span
    class="bookmark-icon"
    data-jtab-role="bookmark-icon"
    :data-jtab-icon-source="source"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="title || getBookmarkHostname(url)"
  >
    <span v-if="loading" class="bookmark-icon__loading" aria-hidden="true" />
    <img v-else-if="imageUrl" :src="imageUrl" alt="" @error="useTextFallback" />
    <span
      v-else
      class="bookmark-icon__text"
      :style="{ backgroundColor: fallbackColor }"
      aria-hidden="true"
    >
      {{ monogram }}
    </span>
    <span class="sr-only">{{ sourceLabel }}</span>
  </span>
</template>
