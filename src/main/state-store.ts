import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Shell-owned state (decision #17). Deliberately separate from pi's own
 * `~/.pi/agent` store: pi owns settings/credentials/extensions, the shell owns
 * navigation, tabs and window geometry.
 */
export interface TabState {
  /** Also the pi `--session-id`. */
  id: string
  cwd: string
}

export interface AppState {
  tabs: TabState[]
  activeTabId: string | null
  recentDirs: string[]
  windowBounds: { width: number; height: number; x?: number; y?: number } | null
}

const DEFAULT_STATE: AppState = {
  tabs: [],
  activeTabId: null,
  recentDirs: [],
  windowBounds: null
}

const MAX_RECENT_DIRS = 12

let cache: AppState | null = null

function statePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

/** Tolerates the Phase 1 shape (`lastProjectDir` / `lastSessionId`). */
function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE }
  const parsed = raw as Partial<AppState> & { lastProjectDir?: string; lastSessionId?: string }

  const tabs = Array.isArray(parsed.tabs)
    ? parsed.tabs
        .filter((tab): tab is TabState => Boolean(tab && typeof tab.id === 'string' && typeof tab.cwd === 'string'))
        .map((tab) => ({ id: tab.id, cwd: tab.cwd }))
    : []

  if (tabs.length === 0 && typeof parsed.lastProjectDir === 'string' && parsed.lastProjectDir) {
    // Phase 1 stored a single session; keep resuming it rather than dropping it.
    const id =
      typeof parsed.lastSessionId === 'string' && parsed.lastSessionId
        ? parsed.lastSessionId
        : `ui${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    tabs.push({ id, cwd: parsed.lastProjectDir })
  }

  return {
    tabs,
    activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : (tabs[0]?.id ?? null),
    recentDirs: Array.isArray(parsed.recentDirs)
      ? parsed.recentDirs.filter((dir): dir is string => typeof dir === 'string')
      : tabs.map((tab) => tab.cwd),
    windowBounds: parsed.windowBounds ?? null
  }
}

export function loadState(): AppState {
  if (cache) return cache
  const file = statePath()
  if (!existsSync(file)) {
    cache = { ...DEFAULT_STATE, tabs: [], recentDirs: [] }
    return cache
  }
  try {
    cache = migrate(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // A corrupt state file must never block startup.
    cache = { ...DEFAULT_STATE }
  }
  return cache
}

export function saveState(patch: Partial<AppState>): AppState {
  const next = { ...loadState(), ...patch }
  cache = next
  const file = statePath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    console.error('[state] failed to persist state:', error)
  }
  return next
}

/** Records a directory at the front of the recents list, de-duplicated. */
export function rememberDir(dir: string): AppState {
  const state = loadState()
  const recentDirs = [dir, ...state.recentDirs.filter((entry) => entry !== dir)].slice(0, MAX_RECENT_DIRS)
  return saveState({ recentDirs })
}
