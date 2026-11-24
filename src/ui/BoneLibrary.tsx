// 左侧骨骼库：按部位分组，列表项可拖拽（HTML5 DnD，dataTransfer 携带模板 key）
import { useMemo, useState } from 'react';
import {
  getResolvedTemplates,
  GROUP_LABELS,
  GROUP_ORDER,
} from '../lib/catalog';
import type { BoneGroupId } from '../types';

export function BoneLibrary() {
  const templates = useMemo(() => getResolvedTemplates(), []);
  const [collapsed, setCollapsed] = useState<Set<BoneGroupId>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<BoneGroupId, typeof templates>();
    for (const t of templates) {
      const arr = map.get(t.group) ?? [];
      arr.push(t);
      map.set(t.group, arr);
    }
    return map;
  }, [templates]);

  const toggle = (g: BoneGroupId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  return (
    <div className="panel scroll-thin">
      <div className="group-header" style={{ paddingLeft: 4 }}>
        <span>骨骼库</span>
        <span className="badge">{templates.length} 种</span>
      </div>
      {GROUP_ORDER.map((g) => {
        const arr = grouped.get(g) ?? [];
        if (!arr.length) return null;
        const isCollapsed = collapsed.has(g);
        return (
          <div key={g}>
            <div className="group-header" onClick={() => toggle(g)} style={{ cursor: 'pointer' }}>
              <span>{isCollapsed ? '▸' : '▾'} {GROUP_LABELS[g]}</span>
              <span className="badge">{arr.length}</span>
            </div>
            {!isCollapsed &&
              arr.map((t) => (
                <div
                  key={t.key}
                  className="bone-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-bone-template', t.key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={`${t.name}（${t.side === 'M' ? '中线' : t.side === 'L' ? '左侧' : '右侧'}）· 拖入场景自动吸附最近插槽`}
                >
                  <span className="dot" />
                  <span>{t.name}</span>
                  <span className="meta">{t.side === 'M' ? '中' : t.side}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
