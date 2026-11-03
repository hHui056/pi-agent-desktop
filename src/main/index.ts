import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describeAgentHome, resolveAgentHome, sharedResourceArgs, type AgentHome } from './agent-home'
import { PtyManager } from './pty-manager'
import { buildPiArgs, buildPiEnv, createSessionId, resolveRuntime } from './pi-runtime'
import { detectGitBash, seedManagedTools } from './preflight'
import { loadState, rememberDir, saveState } from './state-store'
import {
  IPC,
  type BootstrapInfo,
  type EnsureSessionRequest,
  type EnsureSessionResult,
  type SaveTabsRequest,
  type TabDescriptor
} from '../shared/ipc'

// If ELECTRON_RUN_AS_NODE leaked into our own environment, this "Electron app"
// is actually a plain Node process: `require('electron')` yields a path string
// and every `app.*` call fails with a confusing TypeError. Fail loudly instead.
if (!process.versions.electron) {
  console.error(
    '[fatal] Electron is running as Node (ELECTRON_RUN_AS_NODE is set in this ' +
      'environment). Unset it and relaunch: `Remove-Item Env:\\ELECTRON_RUN_AS_NODE`.'
  )
  process.exit(1)
}

/**
 * Startup tracing. Every milestone goes to both stdout and
 * `<userData>/startup.log`, because the failure modes we hit (single-instance
 * lock, userData not writable, renderer load failure) all produce a process that
 * exits without ever showing a window.
 */
function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'startup.log'), `${line}\n`, 'utf8')
  } catch {
    // Logging must never be the reason startup fails.
  }
}

// First thing we can print. Its absence means main.js never executed at all,
// which points at Electron failing to start rather than at our own code.
log(`main module loaded; electron=${process.versions.electron} node=${process.versions.node}`)

const ptyManager = new PtyManager()

let mainWindow: BrowserWindow | null = null
let runtimeError: string | null = null
let toolsSeeded: string[] = []
let agentHome: AgentHome | null = null

function descriptors(): TabDescriptor[] {
  const live = new Map(ptyManager.list().map((session) => [session.id, session]))
  return loadState().tabs.map((tab) => {
    const session = live.get(tab.id)
    return {
      id: tab.id,
      cwd: tab.cwd,
      running: Boolean(session && !session.exited),
      exitCode: session?.exitCode ?? null
    }
  })
}

function createWindow(): void {
  const state = loadState()

  mainWindow = new BrowserWindow({
    width: state.windowBounds?.width ?? 1200,
    height: state.windowBounds?.height ?? 800,
    ...(state.windowBounds?.x !== undefined && state.windowBounds?.y !== undefined
      ? { x: state.windowBounds.x, y: state.windowBounds.y }
      : {}),
    // pi's terminal layer does not clamp its layout, and it falls back to 80x24
    // when the PTY reports nothing. Keep the window above that.
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#1e1e1e',
    show: false,
    title: 'pi-agent-desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    log('window ready-to-show')
    mainWindow?.show()
  })

  // Without this fallback a renderer that never finishes loading leaves a
  // permanently invisible window, which looks exactly like "nothing happened".
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      log('ready-to-show never fired; showing window anyway')
      mainWindow.show()
    }
  }, 5000)

  mainWindow.webContents.on('did-finish-load', () => log('renderer did-finish-load'))
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`renderer did-fail-load code=${code} description=${description} url=${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log(`preload-error path=${preloadPath} error=${error.message}`)
  })
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    log(`renderer console: ${JSON.stringify(args.slice(1))}`)
  })

  // Decision #20: never silently drop a running agent turn.
  mainWindow.on('close', (event) => {
    const running = ptyManager.list().filter((session) => !session.exited)
    if (running.length > 0) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: ['退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'pi 会话仍在运行',
        message: `有 ${running.length} 个 pi 会话正在运行，确定退出吗？`
      })
      if (choice !== 0) {
        event.preventDefault()
        return
      }
    }
    ptyManager.disposeAll()
    const bounds = mainWindow?.getNormalBounds()
    if (bounds) {
      saveState({ windowBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  log(`loading renderer from ${rendererUrl ?? join(__dirname, '../renderer/index.html')}`)
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function parseEnsureRequest(value: unknown): EnsureSessionRequest {
  const request = value as Partial<EnsureSessionRequest> | undefined
  if (!request || typeof request.cwd !== 'string' || request.cwd.length === 0) {
    throw new Error('ensureSession requires a cwd')
  }
  return {
    tabId: typeof request.tabId === 'string' && request.tabId ? request.tabId : null,
    cwd: request.cwd,
    cols: Math.max(20, Math.floor(Number(request.cols) || 80)),
    rows: Math.max(5, Math.floor(Number(request.rows) || 24))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.bootstrap, (): BootstrapInfo => {
    const state = loadState()
    return {
      tabs: descriptors(),
      activeTabId: state.activeTabId,
      recentDirs: state.recentDirs,
      gitBashPath: detectGitBash(),
      runtimeError,
      toolsSeeded,
      agentHomeMode: agentHome?.mode ?? null,
      agentHomeDir: agentHome?.dir ?? null
    }
  })

  ipcMain.handle(IPC.pickProject, async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    rememberDir(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.ensureSession, (event, raw: unknown): EnsureSessionResult => {
    const request = parseEnsureRequest(raw)

    // Reuse a live PTY when a restored/known tab comes back into view.
    if (request.tabId && ptyManager.isRunning(request.tabId)) {
      ptyManager.resize(request.tabId, request.cols, request.rows)
      return { tabId: request.tabId }
    }

    const runtime = resolveRuntime()
    // The renderer generates tab ids so the tab list, the persisted state and
    // the pi `--session-id` are the same string from the start.
    const tabId = request.tabId ?? createSessionId()

    const resourceArgs = agentHome?.mode === 'fallback' ? sharedResourceArgs() : []
    log(
      `session ${tabId} spawning; cwd=${request.cwd} cols=${request.cols} rows=${request.rows} ` +
        `agentHome=${agentHome?.mode ?? 'shared'} resourceArgs=${resourceArgs.length / 2}`
    )
    try {
      ptyManager.spawn({
        id: tabId,
        cwd: request.cwd,
        nodeExe: runtime.nodeExe,
        cliEntry: runtime.cliEntry,
        args: buildPiArgs(tabId, resourceArgs),
        env: buildPiEnv(agentHome?.mode === 'fallback' ? agentHome.dir : undefined),
        cols: request.cols,
        rows: request.rows
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`session ${tabId} spawn FAILED: ${message}`)
      throw error
    }
    log(`session ${tabId} spawned`)

    rememberDir(request.cwd)
    void event
    return { tabId }
  })

  ipcMain.handle(IPC.replaySession, (_event, id: unknown): string => {
    return typeof id === 'string' ? ptyManager.replay(id) : ''
  })

  ipcMain.handle(IPC.closeTab, (event, id: unknown): boolean => {
    if (typeof id !== 'string') return false

    if (ptyManager.isRunning(id)) {
      const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
      const options = {
        type: 'warning' as const,
        buttons: ['关闭', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '关闭标签',
        message: '这个 pi 会话仍在运行，关闭标签会结束它。'
      }
      const choice = window ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)
      if (choice !== 0) return false
    }

    ptyManager.kill(id)
    log(`session ${id} closed by user`)
    return true
  })

  ipcMain.handle(IPC.saveTabs, (_event, raw: unknown): boolean => {
    const request = raw as Partial<SaveTabsRequest> | undefined
    if (!request || !Array.isArray(request.tabs)) return false
    const tabs = request.tabs
      .filter((tab): tab is { id: string; cwd: string } =>
        Boolean(tab && typeof tab.id === 'string' && typeof tab.cwd === 'string')
      )
      .map((tab) => ({ id: tab.id, cwd: tab.cwd }))
    saveState({
      tabs,
      activeTabId: typeof request.activeTabId === 'string' ? request.activeTabId : null
    })
    return true
  })

  ipcMain.on(IPC.writeSession, (_event, id: unknown, data: unknown) => {
    if (typeof id === 'string' && typeof data === 'string') ptyManager.write(id, data)
  })

  ipcMain.on(IPC.resizeSession, (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string') return
    const parsedCols = Math.max(20, Math.floor(Number(cols) || 0))
    const parsedRows = Math.max(5, Math.floor(Number(rows) || 0))
    ptyManager.resize(id, parsedCols, parsedRows)
  })
}

/** PTY events are forwarded once, not per session. */
function forwardSessionEvents(): void {
  ptyManager.on('data', (id: string, data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.sessionData, id, data)
  })
  ptyManager.on('exit', (id: string, exitCode: number) => {
    log(`session ${id} exited code=${exitCode}`)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.sessionExit, id, exitCode)
  })
}

if (!app.requestSingleInstanceLock()) {
  // Silent here used to mean "no window, no error, nothing in the log".
  log('single-instance lock not acquired: another instance already owns the profile. Quitting.')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    log(
      `app ready; electron=${process.versions.electron} node=${process.versions.node} ` +
        `chromium=${process.versions.chrome} packaged=${app.isPackaged} ` +
        `appPath=${app.getAppPath()} userData=${app.getPath('userData')}`
    )

    try {
      const runtime = resolveRuntime()
      log(`runtime node=${runtime.nodeExe}`)
      log(`runtime pi=${runtime.cliEntry}`)
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : String(error)
      log(`runtime ERROR ${runtimeError}`)
    }

    toolsSeeded = seedManagedTools().seeded
    if (toolsSeeded.length > 0) log(`tools seeded ${toolsSeeded.join(', ')}`)

    log(`git bash: ${detectGitBash() ?? 'NOT FOUND'}`)

    try {
      agentHome = resolveAgentHome()
      log(`agent home ${describeAgentHome(agentHome)}`)
    } catch (error) {
      log(`agent home ERROR ${error instanceof Error ? error.message : String(error)}`)
    }

    registerIpc()
    forwardSessionEvents()
    log('ipc registered; creating window')
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    ptyManager.disposeAll()
    app.quit()
  })

  app.on('before-quit', () => {
    ptyManager.disposeAll()
  })
}
