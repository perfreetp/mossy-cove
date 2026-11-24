import type { SandboxEngine } from '../terrain/SandboxEngine';
import { BASE_Y, WORLD_SIZE } from '../terrain/config';
import { useEngineState } from '../terrain/useEngineState';
import { Panel, SliderRow, ToggleRow } from './controls';

export function SectionPanel({ engine }: { engine: SandboxEngine }) {
  const state = useEngineState(engine);
  const half = WORLD_SIZE / 2;
  const boundaries = [BASE_Y, ...state.strataBoundaries, state.heightMax + 20];

  return (
    <Panel index="02" title="分层剖切" icon="◫" className="section-panel">
      <p className="panel-intro">
        启用 X / Y / Z 三个方向的剖切平面。剖切面上会按当前高程区间实时生成五层岩层色带。
      </p>

      <div className="clip-grid">
        <div className={`clip-card ${state.sections.xEnabled ? 'is-on' : ''}`}>
          <ToggleRow label="X 方向" checked={state.sections.xEnabled} onChange={(v) => engine.setSection({ xEnabled: v })} />
          <input
            type="range" min={-half} max={half} step={0.1}
            value={state.sections.x}
            onChange={(e) => engine.setSection({ x: Number(e.target.value) })}
            aria-label="X 剖切位置"
          />
          <output>x = {state.sections.x.toFixed(1)}</output>
        </div>
        <div className={`clip-card ${state.sections.yEnabled ? 'is-on' : ''}`}>
          <ToggleRow label="Y 水平" checked={state.sections.yEnabled} onChange={(v) => engine.setSection({ yEnabled: v })} />
          <input
            type="range" min={BASE_Y} max={7} step={0.1}
            value={state.sections.y}
            onChange={(e) => engine.setSection({ y: Number(e.target.value) })}
            aria-label="Y 剖切位置"
          />
          <output>y = {state.sections.y.toFixed(1)}</output>
        </div>
        <div className={`clip-card ${state.sections.zEnabled ? 'is-on' : ''}`}>
          <ToggleRow label="Z 方向" checked={state.sections.zEnabled} onChange={(v) => engine.setSection({ zEnabled: v })} />
          <input
            type="range" min={-half} max={half} step={0.1}
            value={state.sections.z}
            onChange={(e) => engine.setSection({ z: Number(e.target.value) })}
            aria-label="Z 剖切位置"
          />
          <output>z = {state.sections.z.toFixed(1)}</output>
        </div>
      </div>

      <div className="subgroup">
        <div className="subgroup__title">
          <h3>五层岩层与厚度区间</h3>
          <span className="badge badge--warm">可拖动分界</span>
        </div>
        <div className="strata-list">
          {state.strataNames.map((name, i) => {
            const bottom = boundaries[i];
            const top = boundaries[i + 1];
            const thickness = i === 4 ? Math.max(0, state.heightMax - state.strataBoundaries[3]) : top - bottom;
            return (
              <div className="strata-row" key={name}>
                <i style={{ background: state.strataColors[i] }} />
                <div>
                  <strong>{name}</strong>
                  <small>
                    {i === 4 ? `${state.strataBoundaries[3].toFixed(2)} → 地表` : `${bottom.toFixed(2)} → ${top.toFixed(2)}`}
                    {' · '}厚 {thickness.toFixed(2)}m
                  </small>
                </div>
              </div>
            );
          })}
        </div>
        {state.strataBoundaries.map((boundary, i) => (
          <SliderRow
            key={i}
            label={`分界 ${i + 1}`}
            value={boundary}
            min={BASE_Y + 0.35}
            max={3.8}
            step={0.05}
            onChange={(v) => engine.setStrataBoundary(i, v)}
            format={(v) => `${v.toFixed(2)}m`}
          />
        ))}
      </div>
    </Panel>
  );
}
