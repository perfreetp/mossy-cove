import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  state,
  pathResults,
  beginHistory,
  select,
  updateIce,
  updateLight,
  setLightDistanceToIce,
  removeIce,
  removeLight,
  createGroup,
  dissolveGroup,
  rotateGroupBy,
  groupMembers,
  saveScheme,
  loadScheme,
  deleteScheme,
  setCompare,
  toggleCompare,
  exportFile,
  importFile,
} from '../state/store';
import { ICE_KIND_LABEL, type Light } from '../state/types';
import { firstIceHit } from '../three/transmission';
import { kelvinToCSS } from '../three/kelvin';

/* ---------------- 通用小组件 ---------------- */

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="slider-row">
      <span class="slider-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={() => beginHistory()}
        onInput={(e) => props.onInput(parseFloat(e.currentTarget.value))}
      />
      <span class="slider-value">
        {props.value.toFixed(props.step < 0.1 ? 2 : 1)}
        {props.unit ?? ''}
      </span>
    </label>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="panel-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

/* ---------------- 冰体模块 ---------------- */

function IcePanel() {
  const selected = createMemo(() => {
    const sel = state.selection;
    if (sel?.kind !== 'ice') return null;
    return state.doc.iceBlocks.find((b) => b.id === sel.id) ?? null;
  });
  return (
    <Section title="冰体">
      <div class="item-list">
        <For each={state.doc.iceBlocks}>
          {(b) => (
            <button
              class="item-row"
              classList={{ active: state.selection?.kind === 'ice' && state.selection.id === b.id }}
              onClick={() => select({ kind: 'ice', id: b.id })}
            >
              <span>{b.name}</span>
              <span class="dim">浑浊 {(b.turbidity * 100).toFixed(0)}%</span>
            </button>
          )}
        </For>
      </div>
      <Show when={selected()} keyed>
        {(b) => (
          <div class="editor">
            <Slider
              label="宽度"
              min={0.3}
              max={8}
              step={0.1}
              value={b.size[0]}
              unit="m"
              onInput={(v) => updateIce(b.id, { size: [v, b.size[1], b.size[2]] })}
            />
            <Slider
              label="高度"
              min={0.3}
              max={6}
              step={0.1}
              value={b.size[1]}
              unit="m"
              onInput={(v) => updateIce(b.id, { size: [b.size[0], v, b.size[2]] })}
            />
            <Slider
              label="厚度"
              min={0.1}
              max={3}
              step={0.05}
              value={b.size[2]}
              unit="m"
              onInput={(v) => updateIce(b.id, { size: [b.size[0], b.size[1], v] })}
            />
            <Slider
              label="浑浊度"
              min={0}
              max={1}
              step={0.01}
              value={b.turbidity}
              onInput={(v) => updateIce(b.id, { turbidity: v })}
            />
            <Slider
              label="旋转"
              min={-180}
              max={180}
              step={1}
              value={(b.rotationY * 180) / Math.PI}
              unit="°"
              onInput={(v) => updateIce(b.id, { rotationY: (v * Math.PI) / 180 })}
            />
            <button class="danger" onClick={() => removeIce(b.id)}>
              删除冰体
            </button>
          </div>
        )}
      </Show>
    </Section>
  );
}

/* ---------------- 灯光模块 ---------------- */

function LightPanel() {
  const selected = createMemo(() => {
    const sel = state.selection;
    if (sel?.kind !== 'light') return null;
    return state.doc.lights.find((l) => l.id === sel.id) ?? null;
  });
  const distanceToIce = createMemo(() => {
    const l = selected();
    if (!l) return null;
    const hit = firstIceHit(l, state.doc.iceBlocks);
    return hit ? hit.t : null;
  });
  const groupName = (l: Light) =>
    l.groupId ? (state.doc.groups.find((g) => g.id === l.groupId)?.name ?? '') : '';

  return (
    <Section title="灯光">
      <div class="item-list">
        <For each={state.doc.lights}>
          {(l) => (
            <button
              class="item-row"
              classList={{ active: state.selection?.kind === 'light' && state.selection.id === l.id }}
              onClick={() => select({ kind: 'light', id: l.id })}
            >
              <span class="color-dot" style={{ background: kelvinToCSS(l.kelvin) }} />
              <span>{l.name}</span>
              <span class="dim">{groupName(l)}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={selected()} keyed>
        {(l) => (
          <div class="editor">
            <Slider
              label="方位角"
              min={-180}
              max={180}
              step={1}
              value={l.azimuth}
              unit="°"
              onInput={(v) => updateLight(l.id, { azimuth: v })}
            />
            <Slider
              label="俯仰角"
              min={-80}
              max={80}
              step={1}
              value={l.elevation}
              unit="°"
              onInput={(v) => updateLight(l.id, { elevation: v })}
            />
            <label class="slider-row">
              <span class="slider-label">色温</span>
              <input
                type="range"
                min={1800}
                max={10000}
                step={100}
                value={l.kelvin}
                onPointerDown={() => beginHistory()}
                onInput={(e) => updateLight(l.id, { kelvin: parseFloat(e.currentTarget.value) })}
              />
              <span class="slider-value">
                <span class="color-dot" style={{ background: kelvinToCSS(l.kelvin) }} />
                {l.kelvin}K
              </span>
            </label>
            <Slider
              label="强度"
              min={0}
              max={8}
              step={0.1}
              value={l.intensity}
              onInput={(v) => updateLight(l.id, { intensity: v })}
            />
            <div class="readout">
              <span>离冰面距离</span>
              <strong>{distanceToIce() !== null ? `${distanceToIce()!.toFixed(2)} m` : '未命中冰体'}</strong>
            </div>
            <Slider
              label="设为距离"
              min={0.2}
              max={8}
              step={0.1}
              value={distanceToIce() ?? 1}
              unit="m"
              onInput={(v) => setLightDistanceToIce(l.id, v)}
            />
            <button class="danger" onClick={() => removeLight(l.id)}>
              删除灯
            </button>
          </div>
        )}
      </Show>
    </Section>
  );
}

/* ---------------- 光斑模块 ---------------- */

function SpotPanel() {
  const selected = createMemo(() => {
    const sel = state.selection;
    if (sel?.kind !== 'light') return null;
    return state.doc.lights.find((l) => l.id === sel.id) ?? null;
  });
  const path = createMemo(() => {
    const l = selected();
    if (!l) return null;
    return pathResults().find((p) => p.lightId === l.id) ?? null;
  });

  return (
    <Section title="光斑">
      <Show when={selected()} fallback={<p class="hint">选中一盏灯以调节其光斑</p>} keyed>
        {(l) => (
          <div class="editor">
            <Slider
              label="光斑扩散"
              min={0}
              max={1}
              step={0.01}
              value={l.spread}
              onInput={(v) => updateLight(l.id, { spread: v })}
            />
            <div class="slider-row">
              <span class="slider-label">边缘柔化</span>
              <div class="segmented">
                <For each={[0, 1, 2, 3, 4]}>
                  {(level) => (
                    <button
                      classList={{ active: l.softness === level }}
                      onClick={() => {
                        beginHistory();
                        updateLight(l.id, { softness: level });
                      }}
                    >
                      {level}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show when={path()?.spot} fallback={<p class="hint">光线未到达地面或墙面</p>} keyed>
              {(spot) => (
                <div class="readouts">
                  <div class="readout">
                    <span>光斑中心到冰体距离</span>
                    <strong>{spot.distanceToIce.toFixed(2)} m</strong>
                  </div>
                  <div class="readout">
                    <span>光斑半径</span>
                    <strong>{spot.radius.toFixed(2)} m</strong>
                  </div>
                  <div class="readout">
                    <span>透射总厚度</span>
                    <strong>{spot.totalThickness.toFixed(2)} m</strong>
                  </div>
                  <div class="readout">
                    <span>透射衰减</span>
                    <strong>{((1 - spot.attenuation) * 100).toFixed(1)}%</strong>
                  </div>
                  <div class="readout">
                    <span>有效强度</span>
                    <strong>{spot.intensity.toFixed(2)}</strong>
                  </div>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </Section>
  );
}

/* ---------------- 组合模块 ---------------- */

function GroupPanel() {
  const [checked, setChecked] = createSignal<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(checked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };
  const ungrouped = createMemo(() => state.doc.lights.filter((l) => !l.groupId));

  return (
    <Section title="组合">
      <Show when={ungrouped().length > 0}>
        <p class="hint">勾选未编组的灯,创建灯组:</p>
        <div class="item-list">
          <For each={ungrouped()}>
            {(l) => (
              <label class="item-row check">
                <input
                  type="checkbox"
                  checked={checked().has(l.id)}
                  onChange={() => toggle(l.id)}
                />
                <span class="color-dot" style={{ background: kelvinToCSS(l.kelvin) }} />
                <span>{l.name}</span>
              </label>
            )}
          </For>
        </div>
        <button
          class="primary"
          disabled={checked().size === 0}
          onClick={() => {
            createGroup([...checked()]);
            setChecked(new Set<string>());
          }}
        >
          编组 ({checked().size})
        </button>
      </Show>
      <div class="item-list">
        <For each={state.doc.groups}>
          {(g) => {
            const members = createMemo(() => groupMembers(g.id));
            return (
              <div
                class="group-card"
                classList={{ active: state.selection?.kind === 'group' && state.selection.id === g.id }}
              >
                <div class="group-head">
                  <button class="item-row grow" onClick={() => select({ kind: 'group', id: g.id })}>
                    <span>{g.name}</span>
                    <span class="dim">{members().length} 盏灯</span>
                  </button>
                </div>
                <div class="group-actions">
                  <button onClick={() => rotateGroupBy(g.id, -15)}>↺ 15°</button>
                  <button onClick={() => rotateGroupBy(g.id, 15)}>↻ 15°</button>
                  <button class="danger" onClick={() => dissolveGroup(g.id)}>
                    解散
                  </button>
                </div>
                <p class="hint">选中灯组后,可在场景中用手柄整体平移/旋转</p>
              </div>
            );
          }}
        </For>
      </div>
    </Section>
  );
}

/* ---------------- 方案模块 ---------------- */

function SchemePanel() {
  const [name, setName] = createSignal('');
  let fileInput: HTMLInputElement | undefined;

  const onImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await importFile(file);
    } catch (err) {
      alert(err instanceof Error ? err.message : '导入失败');
    }
    input.value = '';
  };

  return (
    <Section title="方案">
      <div class="scheme-save">
        <input
          type="text"
          placeholder="方案名称"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button
          class="primary"
          disabled={!name().trim()}
          onClick={() => {
            saveScheme(name().trim());
            setName('');
          }}
        >
          保存
        </button>
      </div>
      <div class="item-list">
        <For each={state.schemes}>
          {(s) => (
            <div class="scheme-row">
              <button class="item-row grow" onClick={() => loadScheme(s.id)}>
                <span>{s.name}</span>
                <span class="dim">
                  {s.doc.lights.length} 灯 / {s.doc.iceBlocks.length} 冰
                </span>
              </button>
              <button
                class="mini"
                classList={{ active: state.compareA === s.id }}
                onClick={() => setCompare('A', s.id)}
              >
                A
              </button>
              <button
                class="mini"
                classList={{ active: state.compareB === s.id }}
                onClick={() => setCompare('B', s.id)}
              >
                B
              </button>
              <button class="mini danger" onClick={() => deleteScheme(s.id)}>
                ×
              </button>
            </div>
          )}
        </For>
      </div>
      <button
        class="primary"
        disabled={!state.compareA || !state.compareB}
        onClick={() => toggleCompare()}
      >
        A / B 切换对比
      </button>
      <div class="scheme-io">
        <button onClick={() => exportFile()}>导出文件</button>
        <button onClick={() => fileInput?.click()}>导入文件</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onImport}
        />
      </div>
    </Section>
  );
}

/* ---------------- 侧栏 ---------------- */

export function Sidebar() {
  return (
    <aside class="sidebar">
      <IcePanel />
      <LightPanel />
      <SpotPanel />
      <GroupPanel />
      <SchemePanel />
    </aside>
  );
}
