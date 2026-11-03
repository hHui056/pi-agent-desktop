#!/usr/bin/env node
/**
 * Makes sure the Electron binary exists.
 *
 * npm 11.19+ blocks dependency install scripts by default, which skips the
 * `electron` postinstall that downloads the binary. This script is idempotent and
 * can be re-run at any time.
 *
 * Mirrors are supported through the standard Electron env vars:
 *   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const installScript = join(electronDir, 'install.js')
const exePath = join(electronDir, 'dist', 'electron.exe')

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8')).version
  } catch {
    return '45.2.1'
  }
}

if (!existsSync(electronDir)) {
  console.error('[electron] node_modules/electron is missing. Run `npm install` first.')
  process.exit(1)
}

if (existsSync(exePath)) {
  console.log('[electron] binary already present, nothing to do')
  process.exit(0)
}

const version = readVersion()
const mirror = process.env.ELECTRON_MIRROR
console.log(`[electron] downloading Electron v${version}${mirror ? ` from ${mirror}` : ''}`)

const env = { ...process.env }
// Keep the download cache inside the repo so it never depends on write access to
// %LOCALAPPDATA%.
env.electron_config_cache = env.electron_config_cache ?? join(root, '.electron-cache')

const result = spawnSync(process.execPath, [installScript], {
  cwd: electronDir,
  stdio: 'inherit',
  env
})

if (result.status !== 0 || !existsSync(exePath)) {
  console.error(
    [
      '',
      '[electron] automatic download did not produce dist/electron.exe.',
      '',
      'Manual fallback:',
      `  1. Download  electron-v${version}-win32-x64.zip`,
      `     https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`,
      `     mirror: https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-win32-x64.zip`,
      `  2. Extract the zip so that ${exePath} exists`,
      `  3. Write the text "electron.exe" (no quotes, no newline) to ${join(electronDir, 'path.txt')}`,
      '  4. Re-run: npm run setup'
    ].join('\n')
  )
  process.exit(1)
}

console.log('[electron] ready')
