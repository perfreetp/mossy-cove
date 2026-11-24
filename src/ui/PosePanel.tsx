// 右侧姿态面板：全部关节角度列表、镜像/吸附/剖面/根变换等工具
import { useEffect, useState } from 'react';
import { useStore } from './useStore';
import { skeletonStore } from '../store/skeletonStore';
import { templateByKey } from '../lib/catalog';
import { formatDeg, degToRad } from '../lib/math3d';
import type { BoneInstance, Vec3Tuple } from '../types';

const AXIS_LABELS = ['X', 'Y', 'Z'] as const;

function AngleCell({
  bone,
  axisIndex,
  atLimit,
}: {
  bone: BoneInstance;
  axisIndex: 0 | 1 | 2;
  atLimit: boolean;
}) {
  const [text, setText] = useState(formatDeg(bone.rotation[axisIndex]));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatDeg(bone.rotation[axisIndex]));
  }, [bone.rotation[axisIndex], editing]);

  const commit = () => {
    const deg = parseFloat(text);
    setEditing(false);
    if (Number.isNaN(deg)) {
      setText(formatDeg(bone.rotation[axisIndex]));
      return;
    }
    const next = [...bone.rotation] as Vec3Tuple;
    next[axisIndex] = degToRad(deg);
    skeletonStore.setBoneRotation(bone.id, next);
  };

  return (
    <input
      className={`angle-input ${atLimit ? 'at-limit' : ''}`}
      type="number"
      step="1"
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(formatDeg(bone.rotation[axisIndex]));
          (e.target as HTMLInputElement).blur();
        }
      }}
      title={`${AXIS_LABELS[axisIndex]} 轴角度（度）${atLimit ? ' · 已到关节极限' : ''}`}
    />
  );
}

export function PosePanel() {
  const state = useStore();
  const { project, selectedId, limitHits, mirrorSync } = state;
  const [filter, setFilter] = useState('');

  const rows = project.bones
    .map((b) => ({ bone: b, tpl: templateByKey(`${b.templateBaseId}:${b.side}`) }))
    .filter(({ bone, tpl }) => {
      if (!filter.trim()) return true;
      return tpl.name.includes(filter.trim()) || bone.id.includes(filter.trim());
    });

  return (
    <div className="panel right scroll-thin">
      <div className="section">
        <h3>姿态 · 关节角度（度）</h3>
        <input
          type="text"
          placeholder="筛选骨骼名称…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 6 }}
        />
        <div className="angle-row header">
          <span>关节</span>
          <span style={{ textAlign: 'right' }}>X</span>
          <span style={{ textAlign: 'right' }}>Y</span>
          <span style={{ textAlign: 'right' }}>Z</span>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }} className="scroll-thin">
          {rows.length === 0 && (
            <div style={{ color: 'var(--text-dim)', padding: '8px 2px' }}>
              场景中暂无骨骼
            </div>
          )}
          {rows.map(({ bone, tpl }) => {
            const hits = limitHits.get(bone.id) ?? [];
            return (
              <div
                key={bone.id}
                className={`angle-row ${bone.id === selectedId ? 'selected' : ''}`}
                onClick={() => skeletonStore.select(bone.id)}
                style={{ cursor: 'pointer' }}
                title={bone.id}
              >
                <span className="name">
                  {tpl.name}
                  <span style={{ color: 'var(--text-dim)' }}>
                    {' '}
                    {bone.side === 'M' ? '' : bone.side}
                  </span>
                </span>
                {([0, 1, 2] as const).map((i) => (
                  <AngleCell
                    key={i}
                    bone={bone}
                    axisIndex={i}
                    atLimit={hits.includes(AXIS_LABELS[i].toLowerCase() as 'x' | 'y' | 'z')}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6 }}>
          共 {project.bones.length} 块骨骼 · 红框表示该轴已到活动极限
        </div>
      </div>

      <div className="section">
        <h3>镜像联动</h3>
        <div className="row">
          <label>同步开关</label>
          <div
            className={`switch ${mirrorSync ? 'on' : ''}`}
            onClick={() => skeletonStore.setMirrorSync(!mirrorSync)}
          />
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {mirrorSync ? '改一侧对侧同步' : '两侧独立'}
          </span>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.6 }}>
          选中单侧骨骼后点“镜像复制”，整棵肢体子树反射生成；开启同步后旋转/输入任一侧，对侧按矢状面映射联动。
        </div>
      </div>

      <div className="section">
        <h3>地面吸附</h3>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 6 }}>
          足部（跖骨/掌骨）最低点贴合起伏地形
        </div>
        <div className="row">
          <label>贴地开关</label>
          <GroundSnapSwitch />
        </div>
      </div>

      <ClipSection />
    </div>
  );
}

function GroundSnapSwitch() {
  const on = useStore().project.settings.groundSnap;
  return (
    <div
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => {
        if (!on) {
          // 由 App 通过自定义事件把 SceneManager 的贴地计算结果送进 store
          window.dispatchEvent(new CustomEvent('psr:ground-snap', { detail: { on: true } }));
        } else {
          window.dispatchEvent(new CustomEvent('psr:ground-snap', { detail: { on: false } }));
        }
      }}
    />
  );
}

function ClipSection() {
  const clip = useStore().project.settings.clip;
  return (
    <div className="section">
      <h3>剖面模式</h3>
      <div className="row">
        <label>裁切开关</label>
        <div
          className={`switch ${clip.enabled ? 'on' : ''}`}
          onClick={() => skeletonStore.setClipEnabled(!clip.enabled)}
        />
      </div>
      <div className="row">
        <label>法线方向</label>
      </div>
      <div className="row" style={{ gap: 4 }}>
        {([
          ['+X', [1, 0, 0]],
          ['+Y', [0, 1, 0]],
          ['+Z', [0, 0, 1]],
        ] as const).map(([label, n]) => {
          const active =
            clip.normal[0] === n[0] && clip.normal[1] === n[1] && clip.normal[2] === n[2];
          return (
            <button
              key={label}
              className={active ? 'primary small' : 'small'}
              disabled={!clip.enabled}
              onClick={() =>
                skeletonStore.run('切换裁切方向', (d) => {
                  d.settings.clip.normal = [...n] as Vec3Tuple;
                })
              }
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
        只保留平面法线一侧的骨骼；拖动场景中的青色平面即可调整位置。
      </div>
    </div>
  );
}
