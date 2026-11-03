#!/usr/bin/env node
/**
 * Isolates Electron startup from electron-vite and the terminal, capturing
 * everything to build/diagnose.log.
 *
 *   npm run diagnose
 *
 * Runs two attempts with separate Chromium profiles (so a lingering process
 * cannot lock the second one) and records argv, exit code, stdout, stderr,
 * elapsed time and the app's own startup.log.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const buildDir = join(root, 'build')
const logPath = join(buildDir, 'diagnose.log')

if (!existsSync(electronExe)) {
  console.error(`[diagnose] missing Electron binary at ${electronExe}. Run \`npm run setup\`.`)
  process.exit(1)
}

mkdirSync(buildDir, { recursive: true })
writeFileSync(
  logPath,
  `diagnose run ${new Date().toISOString()}\n` +
    `node=${process.versions.node} platform=${process.platform} arch=${process.arch}\n` +
    `electronExe=${electronExe}\n` +
    `ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE ?? '<unset>'}\n` +
    `NO_SANDBOX=${process.env.NO_SANDBOX ?? '<unset>'}\n\n`,
  'utf8'
)

function runAttempt(label, extraArgs, userDataDir, timeoutMs) {
  return new Promise((resolveAttempt) => {
    const args = [...extraArgs, `--user-data-dir=${userDataDir}`, '.']
    appendFileSync(logPath, `===== ${label} =====\nargv: electron.exe ${args.join(' ')}\n`, 'utf8')

    mkdirSync(userDataDir, { recursive: true })

    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let settled = false

    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    env.ELECTRON_ENABLE_LOGGING = '1'

    const child = spawn(electronExe, args, { cwd: root, env })

    const finish = (resultLine) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      appendFileSync(
        logPath,
        `${resultLine}\nelapsed=${Date.now() - started}ms\n` +
          `stdout:\n${stdout || '(none)'}\nstderr:\n${stderr || '(none)'}\n\n`,
        'utf8'
      )
      resolveAttempt()
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(`result: STILL RUNNING after ${timeoutMs}ms (window was shown)`)
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', (error) => finish(`result: SPAWN ERROR ${error.message}`))
    child.on('close', (code, signal) =>
      finish(`result: exited code=${code} signal=${signal ?? 'none'}`)
    )
  })
}

await runAttempt('A: with --no-sandbox', ['--no-sandbox'], join(buildDir, 'userdata-a'), 15000)
await runAttempt('B: without --no-sandbox', [], join(buildDir, 'userdata-b'), 15000)

/**
 * C replicates electron-vite's own spawn mode exactly: `stdio: 'inherit'`.
 * Output therefore goes to *this* terminal instead of a pipe, and only the exit
 * code can be recorded. If A survives but C dies, the launch mode is the cause.
 */
function runInheritAttempt(label, timeoutMs) {
  return new Promise((resolveAttempt) => {
    const userDataDir = join(buildDir, 'userdata-c')
    const args = ['--no-sandbox', `--user-data-dir=${userDataDir}`, '.']
    appendFileSync(logPath, `===== ${label} =====\nargv: electron.exe ${args.join(' ')}\n`, 'utf8')
    mkdirSync(userDataDir, { recursive: true })

    const started = Date.now()
    let settled = false
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    env.ELECTRON_ENABLE_LOGGING = '1'

    const child = spawn(electronExe, args, { cwd: root, env, stdio: 'inherit' })

    const finish = (line) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      appendFileSync(logPath, `${line}\nelapsed=${Date.now() - started}ms\n\n`, 'utf8')
      resolveAttempt()
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(`result: STILL RUNNING after ${timeoutMs}ms (window was shown)`)
    }, timeoutMs)

    child.on('error', (error) => finish(`result: SPAWN ERROR ${error.message}`))
    child.on('close', (code, signal) =>
      finish(`result: exited code=${code} signal=${signal ?? 'none'}`)
    )
  })
}

await runInheritAttempt('C: stdio inherit (same as electron-vite)', 15000)

for (const [name, dir] of [
  ['A (--no-sandbox)', join(buildDir, 'userdata-a')],
  ['B (default)', join(buildDir, 'userdata-b')],
  ['C (inherit)', join(buildDir, 'userdata-c')]
]) {
  const startupLog = join(dir, 'startup.log')
  appendFileSync(
    logPath,
    `===== app startup.log [${name}] =====\n` +
      (existsSync(startupLog) ? readFileSync(startupLog, 'utf8') : '(not created)') +
      '\n',
    'utf8'
  )
}

console.log(`[diagnose] wrote ${logPath}`)
