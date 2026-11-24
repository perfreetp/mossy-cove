# 案发现场点云空间复原与漫游工具

基于 **TypeScript + Svelte 5 + three.js + potree-core** 的浏览器端点云勘验工具。
点云数据全部存放在浏览器本地（IndexedDB），通过导出工程文件分享，数据默认不出本机。

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 点云加载 | 导入 PotreeConverter 输出目录（2.x `metadata.json` / 1.x `cloud.js`），内置模拟现场生成器 |
| 本地存储 | 整个点云目录写入 IndexedDB，自定义 RequestManager + Range 切片按需读取，刷新不丢 |
| 包围盒裁剪 | 按轴对齐包围盒剔除无关区域，支持数值编辑、一键收窄/扩大、独立撤销重做 |
| 俯视平面图 | 由点云包围盒生成 2D 俯视图，自适应网格、缩放平移、边界框、标记投影、路径、相机位姿 |
| 二三维联动 | 平面图点选 → 三维平滑飞行定位；三维相机移动 → 平面图相机指示实时同步 |
| 证据标记 | 三维任意位置放置，6 类证据带类型编号，球体/编号标签/地面投影光圈，可拖动重定位 |
| 漫游路径 | 沿走位记录关键点，可增删拖动，Catmull-Rom 平滑插值，播放时相机自动朝向路径前方 |
| 撤销重做 | 标记、路径、裁剪各自独立历史栈（容量 100 步），工具栏按钮 + 快捷键 |
| 工程分享 | 导出 `.cspcv`（可含/不含点云大文件），他人导入即恢复裁剪范围、标记、路径 |
| 大体量 | potree LOD 八叉树 + 500 万点预算，几千万点浏览与联动保持流畅 |

## 快速开始

```bash
npm install
npm run dev        # 开发，默认 http://localhost:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

1. 打开页面，点击右上角 **「点云数据 → 🧪 生成模拟案发现场」**，无需外部数据即可体验全流程。
2. 真实数据：用 [PotreeConverter](https://github.com/potree/PotreeConverter) 把 LAS/LAZ 转为
   Potree 目录，再通过 **「导入点云文件夹」** 选择整个输出目录（含 `metadata.json`、
   `octree.bin`、`hierarchy.bin`）。
3. 左侧悬浮面板控制放置证据 / 记录走位，右侧面板管理标记清单与漫游路径，
   左下角是俯视平面图。

## 操作指引

- **裁剪**：右上角「✂ 包围盒裁剪」展开后编辑六向数值，或用「收窄50% / 扩大2倍」快速调整。
- **放标记**：点「📌 放置证据」选类型，在三维点云表面点击；点云拾取落空时自动落到地面平面。
- **拖动标记/路径点**：三维中直接拖动物体（保持高度），或在平面图上拖动投影点（保持 Y）。
- **平面图定位**：单击平面图空白处，三维相机平滑飞到该 XZ 位置；滚轮缩放、Shift+拖动平移。
- **漫游**：「🧭 记录走位」后沿路线依次点击，至少 2 个关键点后在右侧「漫游路径」页播放。
- **快捷键**：
  - `Ctrl/Cmd + Z` 撤销标记，`Ctrl/Cmd + Shift + Z` 重做标记
  - `Ctrl/Cmd + Alt + Z` 撤销路径，`Ctrl/Cmd + Alt + Shift + Z` 重做路径
  - `Ctrl/Cmd + B` 撤销裁剪
- **导出**：右上角「导出分享」，纯工程文件很小（仅坐标 JSON）；完整包会内嵌点云二进制。

## 工程文件格式（.cspcv）

自定义容器，文本头 + 二进制拼接：

```
CSPCV1\n
{ "magic":"CSPCV1", "project": {...}, "embedded":[ {path,offset,length} ... ] }\n
<按清单顺序拼接的点云文件字节>
```

`project` 内含裁剪盒、证据标记坐标/类型/编号、漫游路径关键点与速度、引用的点云键。
不含点云时也可保存为纯 JSON，靠 `cloudKey`/同名记录在对方本机匹配数据。

## 目录结构

```
src/
  lib/
    db.ts                    # IndexedDB 点云/工程仓储
    local-request-manager.ts # potree 本地虚拟源 (local://) 与 Range 切片
    importer.ts              # 点云目录导入与格式识别
    synthetic-cloud.ts       # 浏览器内 Potree 2.x 模拟现场生成
    three-manager.ts         # three.js 场景、potree 加载、裁剪、标记、飞行、漫游
    plan-map-manager.ts      # 2D 平面图绘制与交互
    map-projection.ts        # 世界 XZ ↔ 画布像素映射（裁剪/缩放后保持准确）
    bridge.svelte.ts         # 三维与平面图事件桥接单例
    history.ts               # 通用撤销重做栈
    project-file.ts          # .cspcv 导出/导入容器
    store.svelte.ts          # Svelte 5 runes 全局状态
  components/                # UI 组件（视口、平面图、侧栏、工具栏、裁剪面板等）
scripts/e2e-smoke.ts         # Playwright 端到端冒烟测试（17 项）
```

## 性能与精度要点

- potree-core 点预算设为 500 万，按视锥动态加载八叉树节点，避免一次性载入千万级数据。
- 平面图映射始终基于「当前裁剪盒原点 + 统一 scale/offset」，裁剪变化只更换原点，
  缩放平移走同一套仿射公式，保证二三维坐标严格对应。
- 标记/路径历史栈深拷贝纯 JSON 快照，回滚即整体替换，避免 Svelte 响应式代理污染。
- 渲染循环中强制 `scene.updateMatrixWorld(true)`，补偿 potree 重写方法不递归子树的问题。

## 已知限制

- 裁剪仅支持轴对齐包围盒（AABB），不支持任意多边形/多面体裁剪。
- 模拟现场为单八叉树根节点；真实 PotreeConverter 多级层次数据同样支持加载。
- 浏览器 IndexedDB 容量受配额限制（状态栏显示占用/配额），超大点云建议用纯工程导出。
