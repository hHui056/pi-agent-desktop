interface Props {
  tabs: Array<{ id: string; cwd: string }>
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

function label(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: Props): React.JSX.Element {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeId ? ' active' : ''}`}
          title={tab.cwd}
          onMouseDown={(event) => {
            if (event.button === 0) onSelect(tab.id)
          }}
          onAuxClick={(event) => {
            if (event.button === 1) onClose(tab.id)
          }}
        >
          <span className="tab-label">{label(tab.cwd)}</span>
          <button
            type="button"
            className="tab-close"
            title="关闭标签（Ctrl+Shift+W）"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tab-new" title="新建标签（Ctrl+Shift+T）" onClick={onNew}>
        ＋
      </button>
    </div>
  )
}
