interface Props {
  recentDirs: string[]
  activeCwd: string | null
  onOpen: (dir: string) => void
  onPick: () => void
}

function label(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

export function Sidebar({ recentDirs, activeCwd, onOpen, onPick }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>最近目录</span>
        <button type="button" className="sidebar-pick" title="选择一个新目录" onClick={onPick}>
          ＋
        </button>
      </div>
      <div className="sidebar-list">
        {recentDirs.length === 0 && <div className="sidebar-empty">还没有打开过目录</div>}
        {recentDirs.map((dir) => (
          <button
            key={dir}
            type="button"
            className={`sidebar-item${dir === activeCwd ? ' active' : ''}`}
            title={dir}
            onClick={() => onOpen(dir)}
          >
            <span className="sidebar-item-label">{label(dir)}</span>
            <span className="sidebar-item-path">{dir}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> 新标签
      </div>
    </aside>
  )
}
