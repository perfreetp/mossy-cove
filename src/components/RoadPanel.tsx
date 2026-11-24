import { For, Show, createMemo } from 'solid-js'
import { store } from '../store/network'
import { MATERIAL_LIST, ROAD_WIDTHS, WIDTH_LABELS } from '../constants'
import type { Material, WidthLevel } from '../types'

export default function RoadPanel() {
  const roadId = () => store.selectedRoad[0]()
  const road = createMemo(() => (roadId() ? store.get().roads[roadId()!] : undefined))

  const segmentCount = createMemo(() => {
    const rid = roadId()
    if (!rid) return 0
    return Object.values(store.get().edges).filter((e) => e.roadId === rid).length
  })

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>道路样式</h2>
      </header>
      <Show
        when={road()}
        fallback={
          <div class="panel-empty">
            <p>未选中道路</p>
            <p class="muted">在视口中点击一条道路段,即可调整其宽度档位与路面材质,整条道路的所有分段一起更新。</p>
          </div>
        }
      >
        {(r) => (
          <div class="panel-body">
            <div class="kv-row">
              <span class="muted">道路 ID</span>
              <code>{r().id.slice(-6)}</code>
            </div>
            <div class="kv-row">
              <span class="muted">分段数量</span>
              <strong>{segmentCount()} 段</strong>
            </div>

            <div class="field-group">
              <label class="field-label">宽度档位</label>
              <div class="seg-control">
                <For each={Object.keys(WIDTH_LABELS) as WidthLevel[]}>
                  {(lvl) => (
                    <button
                      class={`seg-btn ${r().widthLevel === lvl ? 'on' : ''}`}
                      onClick={() => store.updateRoad(r().id, { widthLevel: lvl })}
                    >
                      <span
                        class="width-swatch"
                        style={{ height: `${lvl === 'primary' ? 14 : 8}px` }}
                      />
                      <span>{WIDTH_LABELS[lvl]}</span>
                      <span class="muted">{ROAD_WIDTHS[lvl]} m</span>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">路面材质</label>
              <div class="material-grid">
                <For each={MATERIAL_LIST}>
                  {(m) => (
                    <button
                      class={`material-card ${r().material === m.id ? 'on' : ''}`}
                      onClick={() => store.updateRoad(r().id, { material: m.id as Material })}
                    >
                      <span
                        class="material-swatch"
                        style={{
                          background: `rgb(${m.color.map((c) => Math.round(c * 255)).join(',')})`
                        }}
                      />
                      <span class="material-name">{m.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="field-group preview-road">
              <label class="field-label">效果预览</label>
              <div
                class="road-preview"
                style={{
                  height: `${ROAD_WIDTHS[r().widthLevel] * 1.6 + 8}px`,
                  background: `rgb(${MATERIAL_LIST.find((m) => m.id === r().material)!.color
                    .map((c) => Math.round(c * 255))
                    .join(',')})`
                }}
              >
                <span class="road-preview-label">
                  {WIDTH_LABELS[r().widthLevel]} · {MATERIAL_LIST.find((m) => m.id === r().material)!.label}
                </span>
              </div>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}
