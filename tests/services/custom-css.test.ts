import { describe, expect, it } from 'vitest'

import { MAX_CUSTOM_CSS_BYTES, validateCustomCss } from '../../src/services/custom-css'

describe('custom CSS validation', () => {
  it('accepts local design token overrides and data URLs', () => {
    const result = validateCustomCss(`
      :root { --jtab-accent: #137963; }
      [data-jtab-component='bookmark-tile'] {
        border-color: var(--jtab-accent);
        background-image: url(data:image/png;base64,AA==);
      }
    `)

    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
  })

  it.each([
    '@import "https://fonts.example.test/font.css";',
    String.raw`@\69mport "https://fonts.example.test/font.css";`,
    '.tile { background: url(https://images.example.test/a.png) }',
    String.raw`.tile { background: url(h\74tps://images.example.test/a.png) }`,
    '.tile { background: url(//images.example.test/a.png) }',
    '.tile { background: image-set("https://images.example.test/a.png" 1x) }',
  ])('rejects network-capable CSS: %s', (code) => {
    const result = validateCustomCss(code)

    expect(result.valid).toBe(false)
    expect(
      result.issues.some(
        ({ code: issueCode }) => issueCode === 'import' || issueCode === 'remote_url',
      ),
    ).toBe(true)
  })

  it('reports syntax errors instead of silently dropping invalid rules', () => {
    const result = validateCustomCss('.tile { color: red;')

    expect(result.valid).toBe(false)
    expect(result.issues.some(({ code }) => code === 'syntax')).toBe(true)
  })

  it('enforces the byte limit rather than JavaScript character count', () => {
    const result = validateCustomCss('中'.repeat(Math.ceil(MAX_CUSTOM_CSS_BYTES / 3) + 1))

    expect(result.valid).toBe(false)
    expect(result.issues[0]?.code).toBe('too_large')
  })
})
