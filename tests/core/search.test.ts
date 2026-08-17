import { normalizeCustomSearchTemplate } from '../../src/core/search'

describe('custom search templates', () => {
  it('accepts an explicit HTTPS template with a query placeholder', () => {
    expect(normalizeCustomSearchTemplate(' https://search.example.test/?query=%s ')).toBe(
      'https://search.example.test/?query=%s',
    )
  })

  it.each([
    'http://search.example.test/?query=%s',
    'https://search.example.test/?query=missing',
    'https://user:secret@search.example.test/?query=%s',
    'not a URL %s',
  ])('rejects an unsafe or incomplete template: %s', (template) => {
    expect(normalizeCustomSearchTemplate(template)).toBeNull()
  })
})
