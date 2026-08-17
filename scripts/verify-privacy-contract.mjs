import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDirectory, '..')
const sourceRoots = ['entrypoints', 'src']
const sourceExtensions = new Set(['.css', '.html', '.js', '.mjs', '.ts', '.vue'])
const forbiddenPatterns = [
  { pattern: /\/favicon\.ico/iu, reason: 'direct /favicon.ico requests are forbidden' },
  { pattern: /google\.com\/s2\/favicons/iu, reason: 'Google favicon proxy is forbidden' },
  { pattern: /duckduckgo\.com\/ip3/iu, reason: 'DuckDuckGo favicon proxy is forbidden' },
  { pattern: /icon\.horse/iu, reason: 'third-party favicon proxies are forbidden' },
  { pattern: /faviconkit/iu, reason: 'third-party favicon proxies are forbidden' },
  { pattern: /clearbit\.com/iu, reason: 'third-party favicon proxies are forbidden' },
  { pattern: /storage\.sync/u, reason: 'browser sync storage is forbidden' },
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(entryPath)
  }
  return files
}

for (const sourceRoot of sourceRoots) {
  const files = await collectFiles(path.join(projectRoot, sourceRoot))
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const rule of forbiddenPatterns) {
      assert.equal(
        rule.pattern.test(source),
        false,
        `${path.relative(projectRoot, file)}: ${rule.reason}`,
      )
    }
  }
}

stdout.write('Privacy contract verified: no sync storage or external favicon lookups.\n')
