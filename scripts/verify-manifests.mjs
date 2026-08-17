import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDirectory, '..')
const snapshotPath = path.join(scriptsDirectory, 'manifest-permissions.snapshot.json')
const snapshots = JSON.parse(await readFile(snapshotPath, 'utf8'))

const targets = [
  { name: 'chrome-mv3', firefox: false },
  { name: 'firefox-mv3', firefox: true },
]

const forbiddenManifestKeys = [
  'background',
  'content_scripts',
  'host_permissions',
  'optional_host_permissions',
  'optional_permissions',
  'update_url',
  'web_accessible_resources',
]

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

for (const target of targets) {
  const manifestPath = path.join(projectRoot, '.output', target.name, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const expected = snapshots[target.name]

  assert.equal(manifest.manifest_version, 3, `${target.name} must use Manifest V3`)
  assert.deepEqual(
    sorted(manifest.permissions ?? []),
    sorted(expected.permissions),
    `${target.name} permissions changed; review and update the approved snapshot intentionally`,
  )
  assert.deepEqual(
    manifest.chrome_url_overrides,
    { newtab: 'newtab.html' },
    `${target.name} must only override the new tab page`,
  )
  assert.deepEqual(
    manifest.icons,
    {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      96: 'icons/icon-96.png',
      128: 'icons/icon-128.png',
    },
    `${target.name} must package the project-owned icon set`,
  )

  for (const key of forbiddenManifestKeys) {
    assert.equal(key in manifest, false, `${target.name} must not declare ${key}`)
  }

  if (target.firefox) {
    assert.deepEqual(
      manifest.browser_specific_settings,
      { gecko: expected.gecko, gecko_android: expected.gecko_android },
      'Firefox Gecko signing and data-collection declarations changed',
    )
  } else {
    assert.equal(
      'browser_specific_settings' in manifest,
      false,
      'Chromium manifest must not contain Firefox-only settings',
    )
  }
}

stdout.write('Manifest permission snapshots verified for Chrome/Edge and Firefox.\n')
