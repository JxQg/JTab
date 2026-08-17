export const MAX_CUSTOM_CSS_BYTES = 100 * 1024

export function decodeCssEscapes(value: string): string {
  return value.replace(/\\([\da-f]{1,6}[\t\n\f\r ]?|.)/giu, (_match, escaped: string) => {
    const hexadecimal = escaped.trim()
    if (/^[\da-f]{1,6}$/iu.test(hexadecimal)) {
      const codePoint = Number.parseInt(hexadecimal, 16)
      return codePoint === 0 || codePoint > 0x10ffff ? '\ufffd' : String.fromCodePoint(codePoint)
    }
    return escaped
  })
}

export function isRemoteCssUrl(value: string): boolean {
  const normalized = decodeCssEscapes(value)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .trim()
    .replace(/^(['"])(.*)\1$/u, '$2')
    .trim()
  return /^https?:/iu.test(normalized) || normalized.startsWith('//')
}

export function passesCustomCssPrivacyBoundary(code: string): boolean {
  if (new TextEncoder().encode(code).byteLength > MAX_CUSTOM_CSS_BYTES) return false
  const normalized = decodeCssEscapes(code).replace(/\/\*[\s\S]*?\*\//gu, '')
  if (/@import\b/iu.test(normalized)) return false
  if (/(?:url|image-set)\s*\([^)]*(?:https?:|\/\/)/iu.test(normalized)) return false
  return !/['"]\s*(?:https?:|\/\/)/iu.test(normalized)
}
