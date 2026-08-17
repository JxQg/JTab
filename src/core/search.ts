export function normalizeCustomSearchTemplate(value: string): string | null {
  const template = value.trim()
  if (!template.includes('%s')) return null

  try {
    const parsed = new URL(template.replace('%s', 'jtab'))
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      return null
    }
    return template
  } catch {
    return null
  }
}
