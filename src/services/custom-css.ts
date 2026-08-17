import {
  parse,
  walk,
  type Atrule,
  type StringNode,
  type SyntaxParseError,
  type Url,
} from 'css-tree'

import { decodeCssEscapes, isRemoteCssUrl, MAX_CUSTOM_CSS_BYTES } from './custom-css-privacy'

export { MAX_CUSTOM_CSS_BYTES } from './custom-css-privacy'

export type CustomCssErrorCode = 'too_large' | 'syntax' | 'import' | 'remote_url'

export interface CustomCssIssue {
  code: CustomCssErrorCode
  message: string
  line?: number
  column?: number
}

export interface CustomCssValidationResult {
  valid: boolean
  bytes: number
  issues: CustomCssIssue[]
}

function structuralSyntaxIssue(code: string): CustomCssIssue | null {
  const stack: Array<{ character: string; offset: number }> = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let quote: '"' | "'" | null = null
  let quoteOffset = 0
  let inComment = false
  let commentOffset = 0

  const location = (offset: number): { line: number; column: number } => {
    const before = code.slice(0, offset)
    const lines = before.split(/\r\n|\r|\n/u)
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
  }

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index]
    const next = code[index + 1]
    if (inComment) {
      if (character === '*' && next === '/') {
        inComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '/' && next === '*') {
      inComment = true
      commentOffset = index
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      quoteOffset = index
      continue
    }
    if (character === '(' || character === '[' || character === '{') {
      stack.push({ character, offset: index })
      continue
    }
    if (character === ')' || character === ']' || character === '}') {
      const opening = stack.pop()
      if (!opening || opening.character !== pairs[character]) {
        return {
          code: 'syntax',
          message: `存在未匹配的 ${character}。`,
          ...location(index),
        }
      }
    }
  }

  if (inComment) {
    return { code: 'syntax', message: 'CSS 注释没有闭合。', ...location(commentOffset) }
  }
  if (quote) {
    return { code: 'syntax', message: 'CSS 字符串没有闭合。', ...location(quoteOffset) }
  }
  const opening = stack.at(-1)
  if (opening) {
    return {
      code: 'syntax',
      message: `存在未闭合的 ${opening.character}。`,
      ...location(opening.offset),
    }
  }
  return null
}

export function validateCustomCss(code: string): CustomCssValidationResult {
  const bytes = new TextEncoder().encode(code).byteLength
  const issues: CustomCssIssue[] = []
  if (bytes > MAX_CUSTOM_CSS_BYTES) {
    issues.push({
      code: 'too_large',
      message: `CSS 不能超过 ${Math.floor(MAX_CUSTOM_CSS_BYTES / 1024)} KB。`,
    })
    return { valid: false, bytes, issues }
  }
  if (!code.trim()) return { valid: true, bytes, issues }

  const structureIssue = structuralSyntaxIssue(code)
  if (structureIssue) issues.push(structureIssue)

  const parseIssues: SyntaxParseError[] = []
  try {
    const ast = parse(code, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (error) => parseIssues.push(error),
    })

    for (const error of parseIssues) {
      issues.push({
        code: 'syntax',
        message: error.rawMessage || error.message,
      })
    }

    walk(ast, {
      visit: 'Atrule',
      enter(node: Atrule) {
        if (decodeCssEscapes(node.name).toLocaleLowerCase() !== 'import') return
        issues.push({
          code: 'import',
          message: '不允许使用 @import。',
          ...(node.loc?.start.line === undefined ? {} : { line: node.loc.start.line }),
          ...(node.loc?.start.column === undefined ? {} : { column: node.loc.start.column }),
        })
      },
    })
    walk(ast, {
      visit: 'Url',
      enter(node: Url) {
        if (!isRemoteCssUrl(node.value)) return
        issues.push({
          code: 'remote_url',
          message: '不允许在自定义 CSS 中加载远程资源。',
          ...(node.loc?.start.line === undefined ? {} : { line: node.loc.start.line }),
          ...(node.loc?.start.column === undefined ? {} : { column: node.loc.start.column }),
        })
      },
    })
    walk(ast, {
      visit: 'String',
      enter(node: StringNode) {
        if (!isRemoteCssUrl(node.value)) return
        issues.push({
          code: 'remote_url',
          message: '不允许在自定义 CSS 中加载远程资源。',
          ...(node.loc?.start.line === undefined ? {} : { line: node.loc.start.line }),
          ...(node.loc?.start.column === undefined ? {} : { column: node.loc.start.column }),
        })
      },
    })
  } catch (error) {
    const syntaxError = error as Partial<SyntaxParseError>
    issues.push({
      code: 'syntax',
      message:
        syntaxError.rawMessage ?? (error instanceof Error ? error.message : 'CSS 语法无效。'),
    })
  }

  return { valid: issues.length === 0, bytes, issues }
}

export class CustomCssValidationError extends Error {
  constructor(public readonly result: CustomCssValidationResult) {
    super(result.issues[0]?.message ?? 'CSS 校验失败。')
    this.name = 'CustomCssValidationError'
  }
}

export function assertValidCustomCss(code: string): void {
  const result = validateCustomCss(code)
  if (!result.valid) throw new CustomCssValidationError(result)
}
