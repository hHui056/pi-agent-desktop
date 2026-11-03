/** Channel names shared by the main process and the preload bridge. */
export const IPC = {
  bootstrap: 'app:bootstrap',
  pickProject: 'app:pick-project',
  ensureSession: 'session:ensure',
  replaySession: 'session:replay',
  writeSession: 'session:write',
  resizeSession: 'session:resize',
  closeTab: 'tab:close',
  saveTabs: 'tab:save',
  sessionData: 'session:data',
  sessionExit: 'session:exit'
} as const

export interface BootstrapInfo {
  /** Tabs to restore, in display order. */
  tabs: TabDescriptor[]
  activeTabId: string | null
  recentDirs: string[]
  /** Resolved path to bash.exe, or null when Git Bash is missing. */
  gitBashPath: string | null
  /** Non-null when the vendored pi runtime could not be found. */
  runtimeError: string | null
  toolsSeeded: string[]
  /** 'shared' = using ~/.pi; 'fallback' = ~/.pi was not writable, mirroring into the profile. */
  agentHomeMode: 'shared' | 'fallback' | null
  agentHomeDir: string | null
}

export interface TabDescriptor {
  /** Also the pi `--session-id`, so a restored tab resumes the same session. */
  id: string
  cwd: string
  running: boolean
  exitCode: number | null
}

export interface EnsureSessionRequest {
  /** Existing tab id to resume; null/absent creates a new session id. */
  tabId?: string | null
  cwd: string
  cols: number
  rows: number
}

export interface EnsureSessionResult {
  tabId: string
}

export interface SaveTabsRequest {
  tabs: Array<{ id: string; cwd: string }>
  activeTabId: string | null
}
