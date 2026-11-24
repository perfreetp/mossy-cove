import { useState } from 'react';
import type { SandboxEngine } from '../terrain/SandboxEngine';
import { RESOLUTIONS } from '../terrain/config';
import { useEngineState } from '../terrain/useEngineState';
import type { BrushType } from '../terrain/types';
import { Panel, SliderRow, ToggleRow } from './controls';

const BRUSHES: Array<{ type: BrushType; label: string; icon: string; hint: string }> = [
  { type: 'raise', label: '抬升', icon: '⛰', hint: '向上堆积' },
  { type: 'lower', label: '下压', icon: '🕳', hint: '向下侵蚀' },
  { type: 'smooth', label: '平滑', icon: '〰', hint: '均值柔化' },
  { type: 'flatten', label: '抹平', icon: '▤', hint: '对齐起笔高度' }
];

export function BrushPanel({ engine }: { engine: SandboxEngine }) {
  const state = useEngineState(engine);
  const [clusterCount, setClusterCount] = useState(30);
  const [showBuildings, setShowBuildings] = useState(false);

  return (
    <Panel index="01" title="笔刷与建筑" icon="✥" className="brush-panel">
      <div className="segmented">
        <button
          className={state.tool === 'sculpt' ? 'is-active' : ''}
          onClick={() => engine.setTool('sculpt')}
        >
          地形雕刻
        </button>
        <button
          className={state.tool === 'building' ? 'is-active' : ''}
          onClick={() => engine.setTool('building')}
        >
          放置建筑
        </button>
      </div>

      {state.tool === 'sculpt' ? (
        <>
          <div className="brush-grid">
            {BRUSHES.map((brush) => (
              <button
                key={brush.type}
                className={`brush-button ${state.brush.type === brush.type ? 'is-active' : ''}`}
                onClick={() => engine.setBrush({ type: brush.type })}
                title={brush.hint}
              >
                <span aria-hidden>{brush.icon}</span>
                <strong>{brush.label}</strong>
                <small>{brush.hint}</small>
              </button>
            ))}
          </div>

          <SliderRow
            label="笔刷半径"
            value={state.brush.radius}
            min={0.8}
            max={6}
            step={0.1}
            onChange={(radius) => engine.setBrush({ radius })}
            format={(v) => `${v.toFixed(1)} m`}
          />
          <SliderRow
            label="笔刷力度"
            value={state.brush.strength}
            min={5}
            max={100}
            step={1}
            onChange={(strength) => engine.setBrush({ strength })}
            format={(v) => `${v}%`}
          />
          <p className="performance-note">
            拖动时仅更新笔刷包围盒内的高度、法线与实例矩阵；松手后整片法线和剖面重建一次。
          </p>
        </>
      ) : (
        <div className="building-placement-tip">
          <span>🏢</span>
          <div>
            <strong>点击地形放置体块</strong>
            <p>建筑会用双线性高度采样吸附地表；雕刻时，包围盒内的建筑实时升降。</p>
          </div>
        </div>
      )}

      <div className="subgroup">
        <div className="subgroup__title">
          <h3>建筑群布置</h3>
          <span className="badge">{state.buildingCount} 栋</span>
        </div>
        <SliderRow
          label="生成数量"
          value={clusterCount}
          min={20}
          max={40}
          step={1}
          onChange={setClusterCount}
          format={(v) => `${v} 栋`}
        />
        <div className="button-row">
          <button className="button button--primary" onClick={() => engine.generateCluster(clusterCount)}>
            生成建筑群
          </button>
          <button className="button" onClick={() => engine.setTool('building')}>
            手动放置
          </button>
        </div>
        <div className="button-row">
          <button className="button button--ghost" onClick={() => setShowBuildings((v) => !v)}>
            {showBuildings ? '隐藏列表' : '查看列表'}
          </button>
          <button className="button button--danger-ghost" onClick={() => engine.clearBuildings()}>
            清空建筑
          </button>
        </div>
        {showBuildings && (
          <div className="building-list">
            {state.buildings.length === 0 && <p className="empty-line">暂无建筑，可生成 20–40 栋或手动放置。</p>}
            {state.buildings.slice(0, 80).map((building, index) => (
              <div className="building-row" key={building.id}>
                <i style={{ background: building.color }} />
                <span>#{index + 1} · {building.height.toFixed(1)}m</span>
                <button onClick={() => engine.deleteBuilding(building.id)} aria-label={`删除建筑 ${index + 1}`}>×</button>
              </div>
            ))}
            {state.buildings.length > 80 && <p className="empty-line">仅显示前 80 栋，其余会随 JSON 导出。</p>}
          </div>
        )}
        <details className="stress-details">
          <summary>性能压测</summary>
          <button className="button button--ghost" onClick={() => engine.addStressBuildings(1000)}>
            追加 1000 个 InstancedMesh 实例
          </button>
        </details>
      </div>

      <div className="subgroup">
        <h3>网格与水面</h3>
        <label className="select-row">
          <span>分辨率（每边格数）</span>
          <select value={state.resolution} onChange={(e) => void engine.setResolution(Number(e.target.value))}>
            {RESOLUTIONS.map((r) => <option key={r} value={r}>{r} 格 / {r + 1}² 顶点</option>)}
          </select>
        </label>
        <SliderRow
          label="水位高度"
          value={state.waterLevel}
          min={-3}
          max={8}
          step={0.05}
          onChange={(v) => engine.setWaterLevel(v)}
          format={(v) => v.toFixed(2)}
        />
        <ToggleRow label="显示水面" checked={state.waterEnabled} onChange={engine.setWaterEnabled} />
        <ToggleRow label="6 级等高线" checked={state.showContours} onChange={engine.setContoursEnabled} />
        <p className="contour-readout">
          当前高度范围 {state.heightMin.toFixed(2)} ~ {state.heightMax.toFixed(2)}，
          等高距自动分配为 <strong>{state.contourInterval.toFixed(2)} m</strong>
        </p>
      </div>
    </Panel>
  );
}
