import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BootstrapInfo } from '../../shared/ipc'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'

interface Tab {
  id: string
  cwd: string
}

/**
 * Tab ids double as pi `--session-id`, so they must start and end with a letter
 * or digit and contain only letters, digits, `.`, `_` and `-`.
 */
function newTabId(): string {
  return `ui${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const noop = (): void => {}

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<BootstrapInfo | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [recentDirs, setRecentDirs] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void window.piDesktop
      .bootstrap()
      .then((value) => {
        if (cancelled) return
        setInfo(value)
        setTabs(value.tabs.map((tab) => ({ id: tab.id, cwd: tab.cwd })))
        setRecentDirs(value.recentDirs)
        const restored =
          value.activeTabId && value.tabs.some((tab) => tab.id === value.activeTabId)
            ? value.activeTabId
            : (value.tabs[0]?.id ?? null)
        setActiveId(restored)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setInfo({
          tabs: [],
          activeTabId: null,
          recentDirs: [],
          gitBashPath: null,
          runtimeError: cause instanceof Error ? cause.message : String(cause),
          toolsSeeded: [],
          agentHomeMode: null,
          agentHomeDir: null
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist navigation state whenever it changes (but never before bootstrap,
  // which would wipe the restored tabs).
  useEffect(() => {
    if (!info) return
    void window.piDesktop.saveTabs({ tabs, activeTabId: activeId })
  }, [info, tabs, activeId])

  const rememberDir = useCallback((dir: string) => {
    setRecentDirs((prev) => [dir, ...prev.filter((entry) => entry !== dir)].slice(0, 12))
  }, [])

  const openDir = useCallback(
    (cwd: string) => {
      const id = newTabId()
      setTabs((prev) => [...prev, { id, cwd }])
      setActiveId(id)
      rememberDir(cwd)
    },
    [rememberDir]
  )

  const pickAndOpen = useCallback(async () => {
    const dir = await window.piDesktop.pickProject()
    if (dir) openDir(dir)
  }, [openDir])

  const closeTab = useCallback(
    async (id: string) => {
      const allowed = await window.piDesktop.closeTab(id)
      if (!allowed) return
      const remaining = tabs.filter((tab) => tab.id !== id)
      setTabs(remaining)
      if (activeId === id) setActiveId(remaining[remaining.length - 1]?.id ?? null)
    },
    [tabs, activeId]
  )

  const cycleTab = useCallback(
    (delta: number) => {
      if (tabs.length < 2) return
      const index = tabs.findIndex((tab) => tab.id === activeId)
      const next = (index + delta + tabs.length) % tabs.length
      setActiveId(tabs[next].id)
    },
    [tabs, activeId]
  )

  // Application shortcuts use Ctrl+Shift only: bare Ctrl combinations belong to
  // the terminal (Ctrl+W deletes a word in pi's prompt, Ctrl+Tab is input).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.shiftKey) return
      const key = event.key.toLowerCase()

      if (key === 't') {
        event.preventDefault()
        event.stopPropagation()
        void pickAndOpen()
        return
      }
      if (key === 'w') {
        event.preventDefault()
        event.stopPropagation()
        if (activeId) void closeTab(activeId)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        cycleTab(event.altKey ? -1 : 1)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeId, closeTab, cycleTab, pickAndOpen])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null,
    [tabs, activeId]
  )

  if (!info) {
    return <div className="screen">正在启动…</div>
  }

  if (info.runtimeError) {
    return (
      <div className="screen">
        <h1>找不到 pi 运行时</h1>
        <p>
          应用期望在资源目录中找到它，但以下位置不完整。开发环境请先执行{' '}
          <code>npm run seed:runtime</code>。
        </p>
        <div className="error-detail">{info.runtimeError}</div>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="screen">
        <h1>选择一个项目目录</h1>
        <p>
          pi 的工作目录决定了项目配置、资源发现和会话分组。选择后会在这个目录里启动一个 pi
          会话；设置、登录态与扩展与你在终端里使用的 pi 完全共用。
        </p>
        <button type="button" className="primary" onClick={() => void pickAndOpen()}>
          选择项目目录
        </button>
        {recentDirs.length > 0 && (
          <div className="first-run-recents">
            {recentDirs.slice(0, 5).map((dir) => (
              <button key={dir} type="button" onClick={() => openDir(dir)} title={dir}>
                {dir}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        recentDirs={recentDirs}
        activeCwd={activeTab?.cwd ?? null}
        onOpen={openDir}
        onPick={() => void pickAndOpen()}
      />
      <div className="app">
        <TabBar
          tabs={tabs}
          activeId={activeTab?.id ?? null}
          onSelect={setActiveId}
          onClose={(id) => void closeTab(id)}
          onNew={() => void pickAndOpen()}
        />
        {info.agentHomeMode === 'fallback' && (
          <div className="banner">
            <code>~/.pi</code> 不可写，已改用镜像配置目录 <code>{info.agentHomeDir}</code>
            ：登录态与设置在启动时复制，skills / prompts / themes 通过参数直接指向原目录。
            <strong>已安装的 Pi 扩展包在此模式下不加载</strong>；会话也不会出现在终端{' '}
            <code>pi -r</code> 的列表里。
          </div>
        )}
        {!info.gitBashPath && (
          <div className="banner">
            未检测到 Git Bash（<code>C:\Program Files\Git\bin\bash.exe</code>
            ）。pi 的 <code>bash</code> 工具依赖它，缺失时相关工具调用会失败；可在{' '}
            <code>~/.pi/agent/settings.json</code> 里用 <code>shellPath</code> 指定路径。
          </div>
        )}
        {activeTab && (
          <TerminalPane key={activeTab.id} tabId={activeTab.id} cwd={activeTab.cwd} onBound={noop} />
        )}
      </div>
    </div>
  )
}
