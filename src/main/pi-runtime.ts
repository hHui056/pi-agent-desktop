import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Repo-relative pieces of the vendored pi runtime. */
const PI_PACKAGE_RELATIVE = join('node_modules', '@earendil-works', 'pi-coding-agent')
const PI_CLI_RELATIVE = join('dist', 'bundle', 'cli.js')

export class RuntimeNotFoundError extends Error {
  constructor(public readonly missing: string[]) {
    super(`pi runtime is incomplete. Missing: ${missing.join(', ')}`)
    this.name = 'RuntimeNotFoundError'
  }
}

/**
 * Where the pi runtime tree lives.
 *
 * Packaged: `<resources>/pi` (see extraResources in electron-builder.yml).
 * Dev:      `<repo>/build/pi` (produced by `npm run seed:runtime`).
 */
function piRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pi')
    : join(app.getAppPath(), 'build', 'pi')
}

function nodeExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pi', 'node.exe')
    : join(app.getAppPath(), 'vendor', 'node', 'node.exe')
}

export interface PiRuntime {
  nodeExe: string
  cliEntry: string
}

export function resolveRuntime(): PiRuntime {
  const nodeExe = nodeExePath()
  const cliEntry = join(piRoot(), PI_PACKAGE_RELATIVE, PI_CLI_RELATIVE)
  const missing = [nodeExe, cliEntry].filter((candidate) => !existsSync(candidate))
  if (missing.length > 0) throw new RuntimeNotFoundError(missing)
  return { nodeExe, cliEntry }
}

/**
 * `--session-id` ids must start and end with a letter or digit and may contain
 * letters, digits, `.`, `_` and `-`. Keeping the shape stable lets the shell
 * reopen the exact same session without parsing pi's JSONL files.
 */
export function createSessionId(): string {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `ui${stamp}${random}`
}

export function buildPiArgs(sessionId: string, extraArgs: string[] = []): string[] {
  return [
    // Decision #9: `regular` keeps xterm's own scrollback usable; `fullscreen`
    // would take over scrolling via the alternate screen buffer.
    '--tui-mode',
    'regular',
    '--session-id',
    sessionId,
    ...extraArgs
  ]
}

/**
 * Env handed to the pi child process.
 *
 * By default this deliberately does NOT set PI_CODING_AGENT_DIR or
 * PI_CODING_AGENT_SESSION_DIR: decision #6 is to share `~/.pi` with the user's
 * terminal, so settings, credentials, extensions and sessions stay in one place.
 * Stray values inherited from a shell are removed so the desktop app cannot be
 * silently fragmented.
 *
 * `agentDir` is only supplied when `~/.pi` turned out to be unwritable, in which
 * case pi is pointed at a profile-local home that mirrors the user's config
 * (see agent-home.ts).
 */
export function buildPiEnv(agentDir?: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    env[key] = value
  }

  // Leaking this into pi (and therefore into every shell command pi runs) would
  // make any Electron app pi launches start in Node mode. See decision #7 / R2.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  // Packaged Electron restricts NODE_OPTIONS; never forward it to a plain node.exe.
  delete env.NODE_OPTIONS
  delete env.PI_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_SESSION_DIR

  if (agentDir) env.PI_CODING_AGENT_DIR = agentDir

  // Decision #25: pi otherwise shells out to `npm view <pkg> version` once per
  // installed extension on every start. PI_OFFLINE removes that, and is a no-op
  // for model calls because the provider is defined in models.json.
  env.PI_OFFLINE = '1'
  env.PI_SKIP_VERSION_CHECK = '1'

  // pi falls back to 80x24 when the PTY reports no size. Give it a sane default
  // until the first fit/resize lands.
  env.COLORTERM = env.COLORTERM ?? 'truecolor'

  return env
}
