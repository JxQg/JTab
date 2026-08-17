const FALLBACK_COLORS = [
  '#176b5b',
  '#2f6488',
  '#93523a',
  '#6b5b2b',
  '#3f6f43',
  '#7a4f73',
  '#315f6b',
  '#845139',
] as const

export type BookmarkIconSource = 'local' | 'browser' | 'text'

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./iu, '')
  } catch {
    return ''
  }
}

function firstVisibleCharacter(value: string): string | null {
  for (const character of value.normalize('NFKC')) {
    if (/\p{Letter}|\p{Number}/u.test(character)) return character.toLocaleUpperCase()
  }
  return null
}

export function getBookmarkMonogram(title: string, url: string): string {
  return firstVisibleCharacter(title) ?? firstVisibleCharacter(hostnameFromUrl(url)) ?? '#'
}

export function getBookmarkFallbackColor(title: string, url: string): string {
  const seed = `${title}\u0000${hostnameFromUrl(url)}`
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0]
}

export function getBookmarkHostname(url: string): string {
  const hostname = hostnameFromUrl(url)
  if (hostname) return hostname
  try {
    return new URL(url).protocol.replace(':', '')
  } catch {
    return url
  }
}
