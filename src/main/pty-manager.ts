import { EventEmitter } from 'node:events'
import * as nodePty from 'node-pty'

/**
 * How much raw output we keep per session so that a renderer reload can replay
 * the screen instead of losing a running agent turn. 512 KiB of ANSI is far more
 * than a terminal's visible scrollback needs; it only exists to survive a reload.
 */
const MAX_BUFFER_CHARS = 512 * 1024

export interface SpawnOptions {
  id: string
  cwd: string
  nodeExe: string
  cliEntry: string
  args: string[]
  env: Record<string, string>
  cols: number
  rows: number
}

interface Session {
  id: string
  child: nodePty.IPty
  buffer: string[]
  bufferedChars: number
  cols: number
  rows: number
  exited: boolean
  exitCode: number | null
}

export class PtyManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>()

  spawn(options: SpawnOptions): void {
    if (this.sessions.has(options.id)) {
      throw new Error(`PTY session already exists: ${options.id}`)
    }

    // `useConptyDll` selects the bundled conpty.dll/OpenConsole.exe pair. It
    // avoids node-pty's conpty console-list helper, which fails with
    // "AttachConsole failed" when the host process has no console, and it makes
    // pi's differential redraws come through cleanly.
    const ptyOptions = {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
      useConptyDll: true
    } as unknown as nodePty.IPtyForkOptions

    const child = nodePty.spawn(options.nodeExe, [options.cliEntry, ...options.args], ptyOptions)

    const session: Session = {
      id: options.id,
      child,
      buffer: [],
      bufferedChars: 0,
      cols: options.cols,
      rows: options.rows,
      exited: false,
      exitCode: null
    }
    this.sessions.set(options.id, session)

    child.onData((data) => {
      this.appendBuffer(session, data)
      this.emit('data', options.id, data)
    })

    child.onExit(({ exitCode }) => {
      session.exited = true
      session.exitCode = exitCode
      this.emit('exit', options.id, exitCode)
    })
  }

  private appendBuffer(session: Session, data: string): void {
    session.buffer.push(data)
    session.bufferedChars += data.length
    while (session.bufferedChars > MAX_BUFFER_CHARS && session.buffer.length > 1) {
      const dropped = session.buffer.shift()
      session.bufferedChars -= dropped ? dropped.length : 0
    }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session || session.exited) return
    session.child.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.exited) return
    if (session.cols === cols && session.rows === rows) return
    session.cols = cols
    session.rows = rows
    try {
      session.child.resize(cols, rows)
    } catch {
      // The child can vanish between the exited flag and the call; nothing to do.
    }
  }

  replay(id: string): string {
    const session = this.sessions.get(id)
    if (!session) return ''
    return session.buffer.join('')
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  isRunning(id: string): boolean {
    const session = this.sessions.get(id)
    return Boolean(session && !session.exited)
  }

  list(): Array<{ id: string; exited: boolean; exitCode: number | null }> {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      exited: session.exited,
      exitCode: session.exitCode
    }))
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.child.kill()
    } catch {
      // Already gone.
    }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
    this.sessions.clear()
  }
}
