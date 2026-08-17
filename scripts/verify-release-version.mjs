import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { env, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  await readFile(path.join(scriptsDirectory, '..', 'package.json'), 'utf8'),
)
const tag = env.GITHUB_REF_NAME

assert.ok(tag, 'GITHUB_REF_NAME is required when creating a release')
assert.equal(tag, `v${packageJson.version}`, 'Release tag must match package.json version')

stdout.write(`Release tag ${tag} matches package version ${packageJson.version}.\n`)
