# 涉枪现场弹道轨迹三维重建工具

基于 **TypeScript + React 18 + Babylon.js 7 + Vite** 的纯前端三维重建工具。根据射入点、射出点（及中间约束点）复原弹道走向，实时检测弹道与场景障碍物的相交遮挡关系。所有数据保存在浏览器本地，通过导出 JSON 文件分享。

## 工作流程

1. **场景与障碍物搭建** — 放置长方体障碍物，或导入 GLB/GLTF 空间模型（自动测量并归一化包围盒）
2. **弹道点位标注** — 标注射入点、射出点（均带方向箭头），可继续添加中间约束点
3. **轨迹拟合与遮挡检查** — 依据点位拟合平滑弹道曲线并生成弹道管，实时高亮相交段与遮挡位置
4. **轨迹结果导出** — 导出含点位坐标方向、曲线采样点、遮挡判定的 JSON 文件

## 核心能力

| 需求 | 实现 |
| --- | --- |
| 平滑弹道曲线 + 弹道管 | 三次 Hermite/Catmull-Rom 样条，固定 201 采样点，Tube 实例化更新 |
| 弯曲强度档位 | 5 档切线长度系数（近直线 → 大弯），实时重算 |
| 约束点吸附 | 开关切换：开启硬通过精确穿过，关闭为向弦线松弛的软约束 |
| 射入点方向可调 | 旋转 Gizmo 或面板输入方向向量，曲线随之重算 |
| 遮挡实时重判 | 拖动/旋转障碍物时每帧重算，相交段红管高亮 + 入/穿位置标记球，障碍物染色 |
| 多候选弹道对比 | 任意条数，选中一条其余淡出（alpha 0.18），可隐藏/删除 |
| 几百障碍物流畅 | 均匀哈希网格宽相（整数 key + DDA）+ OBB slab 精确测试 + 对象池；300 障碍物纯重算约 4.7ms |
| 本地存储 | IndexedDB 自动保存（防抖 800ms），可恢复草稿 |
| 文件分享 | JSON 导出/导入，模型以 base64 内嵌；导入时 id 重新映射避免冲突 |

## 性能架构

- **引擎与 UI 解耦**：`BallisticEngine` 持有权威数据与 Babylon 场景。Gizmo 拖拽期间在 `onBeforeRender` 帧内直接重算遮挡，**不触发 React 渲染**；交互结束后才同步快照到 zustand，避免拖拽掉帧。
- **宽相剔除**：障碍物世界 AABB 灌入均匀哈希网格（整数打包 key，无字符串拼接），折线段用 3D DDA 只取回邻近候选，复用候选 Set 降低 GC。
- **精确测试**：OBB 线段 slab 法，标量运算零数组分配；每帧 OBB 旋转矩阵只构造一次并缓存，网格建格与全部线段求交共享。
- **几何对象池**：弹道管与遮挡段红管均复用网格，遮挡段固定 41 点重采样以满足 Babylon `Path3D.update` 的恒定点数约束；非激活弹道跳过重建立省开销。

## 目录结构

```
src/
├── types.ts                  # 核心数据类型
├── store.ts                  # zustand 状态、自动保存、导入导出
├── lib/
│   ├── math.ts               # 向量、Hermite 拟合、OBB 求交、哈希网格、遮挡合并
│   ├── storage.ts            # IndexedDB 持久化
│   └── io.ts                 # JSON 导出/导入、id 重映射
├── engine/
│   └── BallisticEngine.ts    # Babylon 场景、Gizmo 交互、实时重算、模型加载
├── components/               # 工具栏、点位/障碍物/弹道面板、状态栏
└── App.tsx
scripts/                      # 数学单测与 CDP 端到端测试（headless Chrome）
```

## 开发与测试

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run test       # 全部测试（需先 npm run dev 起服务，CDP 测试会自动开 headless Chrome）
```

测试分层：
- `test:math` — 纯数学层 10 项（拟合、吸附、弯曲、OBB 旋转、DDA、遮挡区间），Node + esbuild
- `test:func` — 真实 Babylon 引擎 28 项端到端 + 300 障碍物性能基准
- `test:io` — 导出/导入闭环 15 项（结构、id 重映射、数值保留）
- `test:model` — GLB 模型导入 6 项（含手写合法 GLB、包围盒归一化、模型参与遮挡）

## 导出文件结构

```jsonc
{
  "format": "ballistic-trajectory-recon",
  "version": 1,
  "project": {
    "points": [{ "position": [x,y,z], "direction": [x,y,z], "type": "entry|exit|constraint" }],
    "obstacles": [{ "position": [], "rotation": [], "halfExtents": [], "kind": "box|model" }],
    "trajectories": [{
      "bendLevel": 3, "snap": true,
      "samples": [[x,y,z] /* 201 个 */],
      "occlusions": [{ "obstacleName", "tStart", "tEnd", "enterPosition", "exitPosition" }]
    }],
    "assets": [{ "dataUrl": "data:model/gltf-binary;base64,..." }]
  }
}
```
