import { describe, expect, it } from 'vitest'

import {
  getBookmarkFallbackColor,
  getBookmarkHostname,
  getBookmarkMonogram,
} from '../../src/core/icons'

describe('bookmark icon fallbacks', () => {
  it('prefers a visible title character and supports CJK text', () => {
    expect(getBookmarkMonogram('  小舒同学', 'https://example.com')).toBe('小')
    expect(getBookmarkMonogram('---', 'https://www.example.com')).toBe('E')
  })

  it('returns a deterministic local color without looking up a remote asset', () => {
    const first = getBookmarkFallbackColor('Docs', 'https://docs.example.com')
    expect(getBookmarkFallbackColor('Docs', 'https://docs.example.com')).toBe(first)
    expect(first).toMatch(/^#[0-9a-f]{6}$/iu)
  })

  it('formats host names and non-host URL protocols', () => {
    expect(getBookmarkHostname('https://www.example.com/path')).toBe('example.com')
    expect(getBookmarkHostname('file:///C:/notes/index.html')).toBe('file')
  })
})
