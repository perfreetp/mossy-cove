import { store } from '../store/network'
import type { Tool } from '../types'

const TOOLS: Array<{ id: Tool; label: string; icon: string; hint: string }> = [
  { id: 'select', label: '选择/拖动', icon: '➤', hint: '点选路口或道路,拖动路口调整路网' },
  { id: 'place', label: '放置路口', icon: '✚', hint: '在沙盘平面上点击放置新路口节点' },
  { id: 'connect', label: '连接道路', icon: '⤢', hint: '依次点击两个路口,在其间生成道路段' },
  { id: 'split', label: '中点拆分', icon: '⑂', hint: '点击道路段中点手柄,插入路口并拆为两段' },
  { id: 'delete', label: '删除', icon: '✕', hint: '点击路口(自动接续道路)或道路段删除' }
]

export default function Toolbar() {
  return (
    <div class="toolbar">
      {TOOLS.map((t) => (
        <button
          class={`tool-btn ${store.tool[0]() === t.id ? 'active' : ''}`}
          title={t.hint}
          onClick={() => store.tool[1](t.id)}
        >
          <span class="tool-icon">{t.icon}</span>
          <span class="tool-label">{t.label}</span>
        </button>
      ))}
      <div class="toolbar-sep" />
      <button
        class="tool-btn small"
        title="撤销 (Ctrl+Z)"
        disabled={!store.canUndo[0]()}
        onClick={() => store.undo()}
      >
        ↶ 撤销
      </button>
      <button
        class="tool-btn small"
        title="重做 (Ctrl+Y)"
        disabled={!store.canRedo[0]()}
        onClick={() => store.redo()}
      >
        ↷ 重做
      </button>
    </div>
  )
}
