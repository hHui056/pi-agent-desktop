#!/usr/bin/env node
/**
 * Dev launcher tuned for this machine.
 *
 * 1. Electron needs `--no-sandbox` here.
 *    Evidence (`npm run diagnose`): with the flag the app starts and shows a
 *    window; without it the browser process dies ~90 ms after launch with exit
 *    code 0x80000003 and prints nothing, so main.js never runs. This happens in
 *    a plain terminal too, not only in a sandboxed one, so it is a machine
 *    requirement rather than a workaround for one confined shell.
 *
 * 2. The Chromium profile lives inside the repo.
 *    Electron cannot reliably write %APPDATA% on this host: the browser process
 *    fails with `Lock file can not be created: 拒绝访问 (0x5)`. Note that a plain
 *    child process *can* create directories there, so probing from this script
 *    would be misleading — the restriction shows up one process level deeper, in
 *    Electron itself. A repo-local profile is deterministic, easy to reset, and
 *    gitignored. Override with PI_DESKTOP_USER_DATA.
 *
 * Neither change weakens renderer isolation: `webPreferences.sandbox: true`,
 * `contextIsolation` and `nodeIntegration: false` are untouched. Only Chromium's
 * OS-level process sandbox is skipped.
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const viteBin = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const buildDir = join(root, 'build')
const logPath = join(buildDir, 'dev.log')

mkdirSync(buildDir, { recursive: true })
rmSync(logPath, { force: true })

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  try {
    appendFileSync(logPath, `${stamped}\n`, 'utf8')
  } catch {
    // never fatal
  }
}

function resolveProfile() {
  const override = process.env.PI_DESKTOP_USER_DATA
  if (override) return { dir: resolve(override), reason: 'PI_DESKTOP_USER_DATA' }
  return { dir: join(root, '.dev-userdata'), reason: 'repo-local by default' }
}

log(`dev starting; cwd=${process.cwd()}`)
log(`electron=${electronExe} exists=${existsSync(electronExe)}`)
log(`viteBin=${viteBin} exists=${existsSync(viteBin)}`)

if (!existsSync(electronExe)) {
  log('ABORT: Electron binary missing. Run `npm run setup`.')
  process.exit(1)
}
if (!existsSync(viteBin)) {
  log('ABORT: electron-vite entry missing. Run `npm install`.')
  process.exit(1)
}

const probe = spawnSync(electronExe, ['--no-sandbox', '--version'], { encoding: 'utf8' })
log(
  `preflight: status=${probe.status} stdout=${JSON.stringify((probe.stdout ?? '').trim())} ` +
    `stderr=${JSON.stringify((probe.stderr ?? '').trim())}`
)
if (probe.status !== 0) {
  log('ABORT: Electron cannot start even with --no-sandbox. Run `npm run diagnose`.')
  process.exit(1)
}

const profile = resolveProfile()
mkdirSync(profile.dir, { recursive: true })
log(`profile=${profile.dir} (${profile.reason})`)

const args = [viteBin, 'dev', '--noSandbox', '--', `--user-data-dir=${profile.dir}`]
log(`launching: electron-vite dev --noSandbox -- --user-data-dir=${profile.dir}`)

const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, NO_SANDBOX: '1' }
})

const pipe = (stream, target) => {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    target.write(chunk)
    try {
      appendFileSync(logPath, chunk, 'utf8')
    } catch {
      // never fatal
    }
  })
}

pipe(child.stdout, process.stdout)
pipe(child.stderr, process.stderr)

child.on('error', (error) => log(`spawn error: ${error.message}`))
child.on('close', (code, signal) => {
  log(`electron-vite exited code=${code} signal=${signal ?? 'none'}`)
  process.exit(code ?? 1)
})
