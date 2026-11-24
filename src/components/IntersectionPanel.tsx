import { For, Show, createMemo } from 'solid-js'
import { store } from '../store/network'
import { normAngle } from '../lib/terrain'

const PRESET_ANGLES = [0, 45, 90, 135]

export default function IntersectionPanel() {
  const nodeId = () => store.selectedNode[0]()
  const node = createMemo(() => (nodeId() ? store.get().intersections[nodeId()!] : undefined))

  const incident = createMemo(() => (nodeId() ? store.incidentEdges(nodeId()!) : []))

  const neighborName = (edgeId: string, otherId: string) => {
    const all = store.get().intersections
    const ids = Object.keys(all)
    const idx = ids.indexOf(otherId)
    return `路口 ${idx >= 0 ? idx + 1 : '?'}`
  }

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>路口编辑</h2>
      </header>
      <Show
        when={node()}
        fallback={
          <div class="panel-empty">
            <p>未选中路口</p>
            <p class="muted">在视口中点击一个路口节点,或使用「放置路口」工具新建。</p>
          </div>
        }
      >
        {(n) => (
          <div class="panel-body">
            <div class="kv-row">
              <span class="muted">节点 ID</span>
              <code>{n().id.slice(-6)}</code>
            </div>
            <div class="kv-row">
              <span class="muted">平面坐标</span>
              <code>
                {n().x.toFixed(1)}, {n().y.toFixed(1)}
              </code>
            </div>
            <div class="kv-row">
              <span class="muted">连接道路段</span>
              <strong>{incident().length} 条</strong>
            </div>

            <div class="field-group">
              <label class="field-label">连接角度约束</label>
              <div class="angle-presets">
                <button
                  class={`chip ${n().angleConstraint === null ? 'on' : ''}`}
                  onClick={() => store.setAngleConstraint(n().id, null)}
                >
                  无约束
                </button>
                <For each={PRESET_ANGLES}>
                  {(a) => (
                    <button
                      class={`chip ${n().angleConstraint === a ? 'on' : ''}`}
                      onClick={() => store.setAngleConstraint(n().id, a, n().angleTolerance)}
                    >
                      {a}°
                    </button>
                  )}
                </For>
              </div>
              <div class="slider-row">
                <input
                  type="range"
                  min={0}
                  max={345}
                  step={5}
                  value={n().angleConstraint ?? 0}
                  disabled={n().angleConstraint === null}
                  onInput={(e) =>
                    store.setAngleConstraint(n().id, normAngle(Number(e.currentTarget.value)), n().angleTolerance)
                  }
                />
                <span class="slider-val">{n().angleConstraint === null ? '—' : `${n().angleConstraint}°`}</span>
              </div>
              <p class="hint">
                约束轴与反向(±180°)均为合法方向。拖动路口经过不满足约束的位置时,会自动吸附到最近合法角度。
              </p>
            </div>

            <div class="field-group">
              <label class="field-label">吸附容差 ±{n().angleTolerance}°</label>
              <div class="slider-row">
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={n().angleTolerance}
                  onInput={(e) =>
                    store.setAngleConstraint(
                      n().id,
                      n().angleConstraint,
                      Number(e.currentTarget.value)
                    )
                  }
                />
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">相邻路口</label>
              <ul class="neighbor-list">
                <For each={incident()}>
                  {(e) => {
                    const otherId = e.a === n().id ? e.b : e.a
                    const other = store.get().intersections[otherId]
                    const ang = other
                      ? normAngle((Math.atan2(other.y - n().y, other.x - n().x) * 180) / Math.PI)
                      : 0
                    return (
                      <li>
                        <span>{neighborName(e.id, otherId)}</span>
                        <span class="muted">方向 {ang.toFixed(0)}°</span>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </div>

            <div class="field-group">
              <Show when={n().angleConstraint !== null}>
                <button
                  class="btn ghost full"
                  onClick={() => {
                    // 立即按当前约束对所有邻边方向做一次吸附归位
                    store.dragBegin()
                    const s = store.get()
                    const cur = s.intersections[n().id]
                    for (const e of store.incidentEdges(n().id)) {
                      const otherId = e.a === n().id ? e.b : e.a
                      const nb = s.intersections[otherId]
                      if (!nb) continue
                      const r = Math.hypot(cur.x - nb.x, cur.y - nb.y)
                      const cands = [n().angleConstraint!, normAngle(n().angleConstraint! + 180)]
                      const raw = normAngle((Math.atan2(cur.y - nb.y, cur.x - nb.x) * 180) / Math.PI)
                      let best = cands[0]
                      let bd = Infinity
                      for (const c of cands) {
                        let d = Math.abs(raw - c)
                        if (d > 180) d = 360 - d
                        if (d < bd) {
                          bd = d
                          best = c
                        }
                      }
                      const rad = (best * Math.PI) / 180
                      store.dragMove(n().id, {
                        x: nb.x + Math.cos(rad) * r,
                        y: nb.y + Math.sin(rad) * r
                      })
                    }
                    store.dragEnd()
                  }}
                >
                  立即吸附到约束角度
                </button>
              </Show>
              <button class="btn danger full" onClick={() => store.deleteIntersection(n().id)}>
                删除路口(自动接续两端道路)
              </button>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}
