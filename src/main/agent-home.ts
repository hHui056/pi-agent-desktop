import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * pi keeps settings, credentials, extensions and sessions in `~/.pi/agent`.
 * Decision #6 is to share that directory so the desktop app and the terminal see
 * the same identity — but on hosts where the spawning shell is confined, a
 * process this deep in the tree cannot write there (`EPERM`), and pi exits
 * immediately with code 1.
 *
 * So: use the shared directory when it is writable, otherwise fall back to a
 * profile-local agent home, copy the small config/credential files into it, and
 * point pi at the original resource directories with CLI flags
 * (`sharedResourceArgs`). Reads still work in the confined case, which is why
 * flags are enough for skills/prompts/themes.
 *
 * Deliberately NOT mirrored: `npm` (the installed Pi packages, ~96 MB of
 * node_modules). Junction creation is denied on some hosts and a synchronous copy
 * blocks startup for many seconds. Consequence: in fallback mode the user's
 * installed Pi *packages* (extensions) do not load.
 */
export type AgentHomeMode = 'shared' | 'fallback'

export interface AgentHome {
  dir: string
  mode: AgentHomeMode
  copied: string[]
  warnings: string[]
}

/** Files small enough to copy; losing a write there only costs a setting edit. */
const MIRROR_FILES = [
  'settings.json',
  'models.json',
  'models-store.json',
  'mcp.json',
  'auth.json',
  'keybindings.json',
  'trust.json',
  'AGENTS.md',
  'SYSTEM.md',
  'APPEND_SYSTEM.md'
]

const RESOURCE_FLAGS: ReadonlyArray<{ flag: string; dir: string }> = [
  { flag: '--skill', dir: 'skills' },
  { flag: '--prompt-template', dir: 'prompts' },
  { flag: '--theme', dir: 'themes' }
]

export function sharedAgentDir(): string {
  return join(homedir(), '.pi', 'agent')
}

function isWritable(dir: string): boolean {
  const probe = join(dir, `.writable-probe-${process.pid}`)
  try {
    mkdirSync(dir, { recursive: true })
    mkdirSync(probe)
    rmSync(probe, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function copyConfigFiles(target: string, source: string): { copied: string[]; warnings: string[] } {
  const copied: string[] = []
  const warnings: string[] = []

  for (const name of MIRROR_FILES) {
    const from = join(source, name)
    const to = join(target, name)
    if (existsSync(to) || !existsSync(from)) continue
    try {
      copyFileSync(from, to)
      copied.push(name)
    } catch (error) {
      warnings.push(`copy ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { copied, warnings }
}

export function resolveAgentHome(): AgentHome {
  const override = process.env.PI_DESKTOP_AGENT_DIR?.trim()
  const shared = sharedAgentDir()

  if (override) {
    const dir = override
    mkdirSync(dir, { recursive: true })
    const copied = copyConfigFiles(dir, shared)
    return { dir, mode: 'fallback', copied: copied.copied, warnings: copied.warnings }
  }

  // A probe from this process is representative: pi runs one level deeper and is
  // at least as restricted as we are.
  if (isWritable(join(shared, 'sessions'))) {
    return { dir: shared, mode: 'shared', copied: [], warnings: [] }
  }

  const dir = join(app.getPath('userData'), 'pi-agent-home')
  mkdirSync(dir, { recursive: true })
  const copied = copyConfigFiles(dir, shared)
  return { dir, mode: 'fallback', copied: copied.copied, warnings: copied.warnings }
}

/**
 * CLI flags that point pi at the user's real resource directories.
 *
 * Without them a fallback-mode session starts with no skills, slash-command
 * templates or themes, because those are looked up relative to the agent dir.
 */
export function sharedResourceArgs(shared = sharedAgentDir()): string[] {
  const args: string[] = []
  for (const { flag, dir } of RESOURCE_FLAGS) {
    const full = join(shared, dir)
    if (existsSync(full)) args.push(flag, full)
  }
  return args
}

/** Human-readable summary for the startup log. */
export function describeAgentHome(home: AgentHome): string {
  const parts = [`mode=${home.mode}`, `dir=${home.dir}`]
  if (home.copied.length > 0) parts.push(`copied=${home.copied.join(',')}`)
  if (home.warnings.length > 0) parts.push(`warnings=${home.warnings.join(' | ')}`)
  return parts.join(' ')
}
