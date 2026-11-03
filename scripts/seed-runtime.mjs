#!/usr/bin/env node
/**
 * Prepares the vendored pi runtime that the packaged app ships in `resources/pi`:
 *
 *   build/pi/            pi + its full dependency tree, installed as real files
 *   vendor/node/node.exe the Node runtime that executes it
 *   vendor/tools/*.exe   ripgrep / fd seeded into ~/.pi/agent/bin on first run
 *
 * An external node.exe cannot read asar virtual paths, which is why the pi tree
 * lives on disk rather than inside the app bundle.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const piDir = join(root, 'build', 'pi')
const nodeDir = join(root, 'vendor', 'node')
const toolsDir = join(root, 'vendor', 'tools')
const piBinRelative = join('node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')

const log = (message) => console.log(`[seed] ${message}`)
const warn = (message) => console.warn(`[seed] WARNING: ${message}`)

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error(
      `[seed] pi requires Node >= 22.19.0, current runtime is ${process.versions.node}. ` +
        'Switch versions (e.g. `nvm use 26`) and retry.'
    )
    process.exit(1)
  }
}

function writePiManifest() {
  mkdirSync(piDir, { recursive: true })
  const manifest = join(piDir, 'package.json')
  const desired = {
    name: 'pi-agent-desktop-runtime',
    private: true,
    version: '0.0.0',
    description: 'Vendored pi runtime tree shipped in resources/pi. Not part of the app build graph.',
    dependencies: { '@earendil-works/pi-coding-agent': '1.5.0' }
  }
  const current = existsSync(manifest) ? readFileSync(manifest, 'utf8') : ''
  const next = `${JSON.stringify(desired, null, 2)}\n`
  if (current !== next) writeFileSync(manifest, next, 'utf8')
}

function installPi() {
  const cliPath = join(piDir, piBinRelative)
  if (existsSync(cliPath)) {
    log(`pi runtime already present at build/pi`)
    return
  }
  log('installing @earendil-works/pi-coding-agent@1.5.0 into build/pi (this takes a few minutes)')
  const cacheDir = join(root, '.npm-cache')
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cacheDir],
    { cwd: piDir, stdio: 'inherit', shell: process.platform === 'win32' }
  )
  if (result.status !== 0) {
    console.error('[seed] npm install failed')
    process.exit(result.status ?? 1)
  }
}

function copyNodeRuntime() {
  mkdirSync(nodeDir, { recursive: true })
  const target = join(nodeDir, 'node.exe')
  if (existsSync(target)) {
    log('vendor/node/node.exe already present')
    return
  }
  // The dev machine's Node is the same runtime the app ships, so copying it keeps
  // dev and packaged behaviour identical instead of drifting across majors.
  copyFileSync(process.execPath, target)
  log(`copied ${process.execPath} -> ${target}`)
}

function copyTools() {
  mkdirSync(toolsDir, { recursive: true })
  const sources = join(homedir(), '.pi', 'agent', 'bin')
  for (const name of ['rg.exe', 'fd.exe']) {
    const target = join(toolsDir, name)
    if (existsSync(target)) {
      log(`vendor/tools/${name} already present`)
      continue
    }
    const source = join(sources, name)
    if (existsSync(source)) {
      copyFileSync(source, target)
      log(`copied ${name} from ${sources}`)
    } else {
      warn(
        `${name} not found in ${sources}. The app will fall back to a runtime ` +
          'download on first use of pi\'s grep/find tools, which fails offline. ' +
          `Place ${name} in ${toolsDir} manually to ship it.`
      )
    }
  }
}

assertNodeVersion()
writePiManifest()
installPi()
copyNodeRuntime()
copyTools()

const cliPath = join(piDir, piBinRelative)
if (!existsSync(cliPath)) {
  console.error(`[seed] expected pi CLI at ${cliPath} but it is missing`)
  process.exit(1)
}

console.log('')
log('runtime ready:')
log(`  node    ${join(nodeDir, 'node.exe')}`)
log(`  pi      ${cliPath}`)
log(`  tools   ${toolsDir}`)
