import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env, execPath, platform, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDirectory, '..')
const outputDirectory = path.join(projectRoot, '.output')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const temporaryDirectoryPrefix = 'jtab-release-verify-'

const sourceRootFiles = [
  'PRIVACY.md',
  'README.md',
  'eslint.config.js',
  'package.json',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vitest.config.ts',
  'wxt.config.ts',
]
const sourceDirectories = ['docs', 'entrypoints', 'public', 'scripts', 'src']
const forbiddenPrefixes = [
  '.agents/',
  '.cache/',
  '.codex/',
  '.git/',
  '.output/',
  '.pnpm-store/',
  '.wxt/',
  'artifacts/',
  'coverage/',
  'node_modules/',
  'output/',
  'playwright-report/',
  'test-results/',
  'tests/',
]

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('ZIP end-of-central-directory record not found')
}

function validateZipEntryName(name) {
  assert.ok(name, 'ZIP entries must have a name')
  assert.equal(name.includes('\0'), false, `ZIP entry contains a null byte: ${name}`)
  assert.equal(name.includes('\\'), false, `ZIP entry must use forward slashes: ${name}`)
  assert.equal(path.posix.isAbsolute(name), false, `ZIP entry must be relative: ${name}`)

  const isDirectory = name.endsWith('/')
  const segments = (isDirectory ? name.slice(0, -1) : name).split('/')
  assert.equal(
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.includes(':') || segment === '~',
    ),
    false,
    `ZIP entry contains an unsafe path segment: ${name}`,
  )
}

function readZipEntries(archive) {
  const endOffset = findEndOfCentralDirectory(archive)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16)
  assert.notEqual(entryCount, 0xffff, 'ZIP64 archives are not supported by this verifier')

  const entries = new Map()
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'Invalid ZIP central directory')
    const flags = archive.readUInt16LE(offset + 8)
    const compressionMethod = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    validateZipEntryName(name)
    assert.equal(flags & 1, 0, `Encrypted ZIP entry is not supported: ${name}`)
    assert.equal(entries.has(name), false, `ZIP contains a duplicate entry: ${name}`)
    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readZipEntry(archive, entry) {
  const offset = entry.localHeaderOffset
  assert.equal(archive.readUInt32LE(offset), 0x04034b50, `Invalid local header for ${entry.name}`)
  const nameLength = archive.readUInt16LE(offset + 26)
  const extraLength = archive.readUInt16LE(offset + 28)
  const localName = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
  assert.equal(localName, entry.name, `ZIP local and central names differ for ${entry.name}`)
  const dataOffset = offset + 30 + nameLength + extraLength
  const compressed = archive.subarray(dataOffset, dataOffset + entry.compressedSize)
  const contents =
    entry.compressionMethod === 0
      ? compressed
      : entry.compressionMethod === 8
        ? inflateRawSync(compressed)
        : assert.fail(
            `Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`,
          )
  assert.equal(contents.length, entry.uncompressedSize, `Size mismatch for ${entry.name}`)
  return contents
}

function toArchivePath(value) {
  return value.split(path.sep).join('/')
}

async function collectFiles(directory, prefix = '') {
  const files = new Map()
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `Release input must not contain links: ${relativePath}`,
    )
    if (entry.isDirectory()) {
      const descendants = await collectFiles(entryPath, relativePath)
      for (const [name, filePath] of descendants) files.set(name, filePath)
    } else if (entry.isFile()) {
      files.set(toArchivePath(relativePath), entryPath)
    } else {
      assert.fail(`Unsupported release input type: ${relativePath}`)
    }
  }
  return files
}

function fileEntries(entries) {
  return new Map([...entries].filter(([name]) => !name.endsWith('/')))
}

function assertSameFileList(leftNames, rightNames, label) {
  assert.deepEqual(
    [...leftNames].sort((left, right) => left.localeCompare(right)),
    [...rightNames].sort((left, right) => left.localeCompare(right)),
    `${label} file list differs`,
  )
}

async function assertArchiveMatchesFiles(archivePath, files, label) {
  const archive = await readFile(archivePath)
  const entries = fileEntries(readZipEntries(archive))
  assertSameFileList(entries.keys(), files.keys(), label)

  for (const [name, filePath] of files) {
    const archivedEntry = entries.get(name)
    assert.ok(archivedEntry, `${label} is missing ${name}`)
    const archivedContents = readZipEntry(archive, archivedEntry)
    const fileContents = await readFile(filePath)
    assert.equal(archivedContents.equals(fileContents), true, `${label} differs from ${filePath}`)
  }
}

async function expectedSourceFiles() {
  const files = new Map()
  for (const relativePath of sourceRootFiles) {
    const filePath = path.join(projectRoot, relativePath)
    const stats = await lstat(filePath)
    assert.equal(stats.isFile(), true, `Source whitelist entry must be a file: ${relativePath}`)
    files.set(toArchivePath(relativePath), filePath)
  }
  for (const directory of sourceDirectories) {
    const descendants = await collectFiles(path.join(projectRoot, directory), directory)
    for (const [name, filePath] of descendants) files.set(name, filePath)
  }
  return files
}

function assertForbiddenPathsAbsent(entries, archiveName) {
  for (const name of entries.keys()) {
    assert.equal(
      forbiddenPrefixes.some((prefix) => name.startsWith(prefix)),
      false,
      `${archiveName} contains forbidden path ${name}`,
    )
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

async function extractArchive(archivePath, destination) {
  const archive = await readFile(archivePath)
  const entries = readZipEntries(archive)
  for (const entry of entries.values()) {
    const destinationPath = path.resolve(destination, ...entry.name.split('/'))
    assert.equal(
      isPathInside(destination, destinationPath),
      true,
      `ZIP entry escapes extraction directory: ${entry.name}`,
    )
    if (entry.name.endsWith('/')) {
      await mkdir(destinationPath, { recursive: true })
      continue
    }
    await mkdir(path.dirname(destinationPath), { recursive: true })
    await writeFile(destinationPath, readZipEntry(archive, entry), { flag: 'wx' })
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`})`))
    })
  })
}

async function removeVerifiedTemporaryDirectory(directory) {
  const resolvedTemporaryRoot = await realpath(tmpdir())
  const resolvedDirectory = await realpath(directory)
  const samePath = (left, right) =>
    platform === 'win32'
      ? left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
      : left === right
  assert.equal(
    samePath(path.dirname(resolvedDirectory), resolvedTemporaryRoot),
    true,
    `Refusing to remove a directory outside the system temp root: ${resolvedDirectory}`,
  )
  assert.equal(
    path.basename(resolvedDirectory).startsWith(temporaryDirectoryPrefix),
    true,
    `Refusing to remove a directory without the verifier prefix: ${resolvedDirectory}`,
  )
  await rm(resolvedDirectory, { recursive: true })
}

async function unlinkVerifiedNodeModulesLink(linkPath) {
  let stats
  try {
    stats = await lstat(linkPath)
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return
    throw cause
  }
  assert.equal(
    stats.isSymbolicLink(),
    true,
    `Refusing recursive cleanup because node_modules is not a link: ${linkPath}`,
  )
  await unlink(linkPath)
}

async function verifyReproducibleBuild(sourceArchivePath) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), temporaryDirectoryPrefix))
  const nodeModulesLink = path.join(temporaryRoot, 'node_modules')
  try {
    await extractArchive(sourceArchivePath, temporaryRoot)
    const workspaceNodeModules = await realpath(path.join(projectRoot, 'node_modules'))
    await symlink(workspaceNodeModules, nodeModulesLink, platform === 'win32' ? 'junction' : 'dir')

    const wxtCli = path.join(nodeModulesLink, 'wxt', 'bin', 'wxt.mjs')
    await run(execPath, [wxtCli, 'build', '-b', 'chrome', '--mv3'], temporaryRoot)
    await run(execPath, [wxtCli, 'build', '-b', 'firefox', '--mv3'], temporaryRoot)

    for (const target of ['chrome-mv3', 'firefox-mv3']) {
      const rebuiltFiles = await collectFiles(path.join(temporaryRoot, '.output', target))
      const releaseFiles = await collectFiles(path.join(outputDirectory, target))
      assertSameFileList(
        rebuiltFiles.keys(),
        releaseFiles.keys(),
        `Rebuilt ${target} and release output`,
      )
      for (const [name, rebuiltPath] of rebuiltFiles) {
        const releasePath = releaseFiles.get(name)
        assert.ok(releasePath, `Release output is missing rebuilt file ${target}/${name}`)
        assert.equal(
          (await readFile(rebuiltPath)).equals(await readFile(releasePath)),
          true,
          `Rebuilt ${target}/${name} differs from the release output`,
        )
      }
    }
  } finally {
    await unlinkVerifiedNodeModulesLink(nodeModulesLink)
    await removeVerifiedTemporaryDirectory(temporaryRoot)
  }
}

const archiveDefinitions = [
  {
    file: `jtab-${packageJson.version}-chrome.zip`,
    outputTarget: 'chrome-mv3',
    required: ['manifest.json', 'newtab.html', 'icons/icon-128.png'],
  },
  {
    file: `jtab-${packageJson.version}-firefox.zip`,
    outputTarget: 'firefox-mv3',
    required: ['manifest.json', 'newtab.html', 'icons/icon-128.png'],
  },
]

for (const definition of archiveDefinitions) {
  const archivePath = path.join(outputDirectory, definition.file)
  const archive = await readFile(archivePath)
  const allEntries = readZipEntries(archive)
  assertForbiddenPathsAbsent(allEntries, definition.file)
  const entries = fileEntries(allEntries)
  for (const required of definition.required) {
    assert.equal(entries.has(required), true, `${definition.file} is missing ${required}`)
  }
  const outputFiles = await collectFiles(path.join(outputDirectory, definition.outputTarget))
  await assertArchiveMatchesFiles(archivePath, outputFiles, definition.file)
}

const sourceArchivePath = path.join(outputDirectory, `jtab-${packageJson.version}-sources.zip`)
const sourceArchive = await readFile(sourceArchivePath)
const allSourceEntries = readZipEntries(sourceArchive)
assertForbiddenPathsAbsent(allSourceEntries, path.basename(sourceArchivePath))
const sourceFiles = await expectedSourceFiles()
await assertArchiveMatchesFiles(sourceArchivePath, sourceFiles, path.basename(sourceArchivePath))
await verifyReproducibleBuild(sourceArchivePath)

stdout.write(
  'Release ZIPs match their complete outputs and source whitelist; reproducible Chrome/Firefox builds verified.\n',
)
