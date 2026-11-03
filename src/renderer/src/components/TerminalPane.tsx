import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'

type Status = 'starting' | 'running' | 'exited' | 'error'

interface Props {
  /** Tab to bind to, or null for a new session (the id is reported via onBound). */
  tabId: string | null
  cwd: string
  onBound: (tabId: string) => void
}

const THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#a9b7c6',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d4d4d4',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

export function TerminalPane({ tabId, cwd, onBound }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [rendererKind, setRendererKind] = useState<'webgl' | 'dom'>('dom')
  const [generation, setGeneration] = useState(0)

  const restart = useCallback(() => {
    setExitCode(null)
    setError(null)
    setStatus('starting')
    setGeneration((value) => value + 1)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Mono','Consolas','Microsoft YaHei Mono',monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: THEME
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    // WebGL is the recommended renderer (xterm 6 dropped canvas), but it can be
    // unavailable on RDP sessions, VMs and blocklisted GPUs. Fall back to DOM.
    let webgl: WebglAddon | null = null
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        try {
          addon.dispose()
        } catch {
          // ignore
        }
        webgl = null
        setRendererKind('dom')
      })
      term.loadAddon(addon)
      webgl = addon
      setRendererKind('webgl')
    } catch {
      setRendererKind('dom')
    }

    try {
      term.loadAddon(new WebLinksAddon())
    } catch {
      // Non-fatal.
    }

    const safeFit = (): void => {
      try {
        fit.fit()
      } catch {
        // The host can be 0x0 during the first frame.
      }
    }

    let disposed = false
    let boundId: string | null = tabId
    let snapshotWritten = false
    let replayMark = 0
    const pending: Array<{ id: string; data: string }> = []

    const offData = window.piDesktop.onData((id, data) => {
      if (disposed) return
      if (!snapshotWritten) {
        pending.push({ id, data })
        return
      }
      if (id === boundId) term.write(data)
    })

    const offExit = window.piDesktop.onExit((id, code) => {
      if (disposed || id !== boundId) return
      setStatus('exited')
      setExitCode(code)
      term.write(`\r\n\x1b[38;2;126;136;142m[pi 进程已退出，code=${code}]\x1b[0m\r\n`)
    })

    const dataSub = term.onData((data) => {
      if (boundId) window.piDesktop.write(boundId, data)
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (boundId) window.piDesktop.resize(boundId, cols, rows)
    })

    const titleSub = term.onTitleChange((title) => {
      if (title) document.title = title
    })

    const start = async (): Promise<void> => {
      safeFit()
      try {
        const result = await window.piDesktop.ensureSession({
          tabId,
          cwd,
          cols: term.cols,
          rows: term.rows
        })
        boundId = result.tabId
        onBound(result.tabId)

        // Anything captured before the replay snapshot was taken is already in
        // the snapshot; only the tail that arrived afterwards must be replayed
        // on top of it.
        replayMark = pending.length
        const history = await window.piDesktop.replay(result.tabId)
        if (disposed) return
        if (history) term.write(history)
        snapshotWritten = true
        for (const item of pending.slice(replayMark)) {
          if (item.id === boundId) term.write(item.data)
        }
        setStatus('running')
      } catch (cause) {
        if (disposed) return
        snapshotWritten = true
        setStatus('error')
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    void start()

    // xterm's own resize event only fires after fit() changes the grid, and pi's
    // SIGWINCH path is a no-op on Windows, so the PTY must be resized explicitly.
    const observer = new ResizeObserver(() => safeFit())
    observer.observe(host)
    const raf = window.requestAnimationFrame(safeFit)

    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      observer.disconnect()
      offData()
      offExit()
      dataSub.dispose()
      resizeSub.dispose()
      titleSub.dispose()
      try {
        webgl?.dispose()
      } catch {
        // ignore
      }
      term.dispose()
    }
    // `onBound` is stable (useCallback in the parent); tabId/cwd/generation are
    // the real remount triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, cwd, generation])

  return (
    <>
      <div className="toolbar">
        <span className="path" title={cwd}>
          {cwd}
        </span>
        <span className="spacer" />
        <span className={`status-pill${status === 'error' ? ' error' : ''}`}>
          {status === 'starting' && '启动中'}
          {status === 'running' && `运行中 · ${rendererKind}`}
          {status === 'exited' && `已退出 · code=${exitCode ?? '?'}`}
          {status === 'error' && '启动失败'}
        </span>
        {(status === 'exited' || status === 'error') && (
          <button type="button" onClick={restart}>
            重新启动
          </button>
        )}
      </div>
      {status === 'error' && error && <div className="error-detail">{error}</div>}
      <div className="term-host" ref={hostRef} />
    </>
  )
}
