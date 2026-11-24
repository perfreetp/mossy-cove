// 顶栏：撤销/重做、变换模式、镜像、导入导出、演示骨架
import { useStore } from './useStore';
import { skeletonStore } from '../store/skeletonStore';

export function TopBar({
  onExport,
  onImport,
  onLoadDemo,
  onMirror,
  onDelete,
}: {
  onExport: () => void;
  onImport: (file: File) => void;
  onLoadDemo: () => void;
  onMirror: () => void;
  onDelete: () => void;
}) {
  const state = useStore();
  const selected = state.project.bones.find((b) => b.id === state.selectedId);

  return (
    <div className="topbar">
      <span className="title">🦴 古生物骨骼装配与姿态复原工作台</span>

      <button onClick={() => skeletonStore.undo()} disabled={!state.canUndo} title="Ctrl+Z">
        ↶ 撤销
      </button>
      <button onClick={() => skeletonStore.redo()} disabled={!state.canRedo} title="Ctrl+Y">
        ↷ 重做
      </button>

      <div className="mode-toggle" style={{ marginLeft: 8 }}>
        <button
          className={state.transformMode === 'rotate' ? 'active' : ''}
          onClick={() => skeletonStore.setTransformMode('rotate')}
          title="选中骨骼后拖动局部坐标轴绕关节旋转"
        >
          关节旋转
        </button>
        <button
          className={state.transformMode === 'root' ? 'active' : ''}
          onClick={() => skeletonStore.setTransformMode('root')}
          title="平移整具骨架"
        >
          整体平移
        </button>
      </div>

      <button onClick={onMirror} disabled={!selected || selected.side === 'M'} title="镜像复制选中骨骼的整棵子树">
        🪞 镜像复制
      </button>
      <button className="danger" onClick={onDelete} disabled={!selected}>
        删除
      </button>

      <span className="spacer" />

      <span className="badge" title="当前场景骨骼数量">
        {state.project.bones.length} 块骨骼
      </span>
      <button onClick={onLoadDemo}>载入演示骨架</button>
      <button onClick={onExport} className="primary">
        导出数据
      </button>
      <button onClick={() => document.getElementById('import-file')?.click()}>
        导入数据
      </button>
      <input
        id="import-file"
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
