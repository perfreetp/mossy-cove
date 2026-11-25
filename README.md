# 化石内部结构剖面查看工具

基于 **TypeScript + Svelte 5 + three.js + manifold-3d** 的化石实体剖切与截面分析工具。
导入化石网格后构建为有效实体(二维流形),提供三个互相垂直的可拖动剖切平面,
实时显示内部截面,并支持序列切片、几何测量、轮廓导出与视图方案管理。

## 功能

### 实体与剖切
- 导入 **STL / OBJ / PLY / GLB / GLTF**,在 Web Worker 内用 manifold-3d 构建实体几何;
  非闭合网格会给出明确的流形错误提示。
- 三个互相垂直的剖切平面(X/Y/Z),每个含:
  - **平移手柄**(法向末端方块):沿自身法向拖动,基于面向相机的拾取平面,任意视角都可操作;
  - **旋转环**(平面内圆环):拖动改变法向;
  - 开关(整体启用/关闭)与单独"隐藏截面"开关。
- three.js `clippingPlanes` 实时裁剪实体,截面用 manifold `slice` 计算真实轮廓,
  **闭合线条描边 + 半透明填充**(外轮廓与孔自动区分),孔在 2D 图中以背景色区分。

### 角度锁定与吸附
- 顶栏开启角度锁定后,旋转按固定步长(默认 15°,可调 5–90°)吸附;
- 法向靠近世界 ±X/±Y/±Z 正交方向时自动吸附到正交轴。

### 序列切片
- 设定方向、数量(2–40)与归一化范围,一次性生成十几张截面;
- 范围沿**当前平面法向投影**包围盒计算(旋转平面同样正确);
- 缩略图网格并排显示,可逐张翻看(翻页器 + 点击缩略图)。

### 测量
- **两点距离**:在截面上点选两个点,给出空间直线距离;
- **轮廓面积**:点选任一闭合轮廓(外环或孔),给出其包围面积,并高亮该轮廓。

### 导出
- 单个交互截面或序列切片:PNG 图片、轮廓点坐标 **JSON**(含 2D/3D 点、面积、坐标基)与 **TXT**;
- 整组切片坐标一次性导出;
- 3D 视口截图导出。

### 视图方案
- 把三个平面的位置/法向/颜色、切片参数、角度锁定设置保存为命名方案(localStorage 持久化);
- 一键恢复完整剖切状态。

## 性能设计

- 重计算全部在 **两个独立 Web Worker**(交互通道 / 批量通道)的 manifold WASM 中进行,不阻塞渲染;
- 交互请求按平面**代次管理 + 同平面合并(dirty 标记)**,过时结果自动丢弃,松手保证最终态补算;
- 约 1.1 万面模型实测:交互切片 **p50 ≈ 5ms / p90 < 30ms**,16 张批量切片约 80ms,拖动跟手;
- 截面三角化用 manifold 原生 `triangulate`,自动正确处理带孔多边形。

## 技术结构

```
src/
  lib/
    manifold-worker.ts   Worker:Manifold 实体构建 + 任意法向 slice + 三角化
    section-worker.ts    双 Worker 封装:代次管理、请求合并、响应式代理剥离
    fossil-viewer.ts     three.js 场景:裁剪、Gizmo 拾取拖动、截面渲染、测量
    plane-gizmo.ts       剖切平面 Gizmo(平面/边框/平移手柄/旋转环/法向箭头)
    mesh-loaders.ts      STL/OBJ/PLY 手写解析 + GLTF(three GLTFLoader)
    demo-model.ts        内置菊石示例(manifold 原生 CSG,保证有效流形)
    section-draw.ts      截面 2D 绘制、PNG/JSON/TXT 导出
    app-state.svelte.ts  Svelte 5 runes 全局状态与截面调度(.svelte.ts 才能用 $state)
    math.ts              向量/矩阵、平面正交基、吸附、有符号面积
    types.ts             共享类型与 Worker 消息协议
  components/            Svelte UI 面板与 3D 视口
tests/                   Vitest 单测/性能测试 + headless Chrome e2e
```

关键几何约定:把模型经"世界→平面局部"仿射变换(法向对齐局部 +Z、平面点对齐原点),
`Manifold.slice(0)` 得到 `CrossSection`,`toPolygons()` 取闭合环,再映射回世界坐标。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm run check      # svelte-check 类型检查
npm run test       # Vitest 单元 + 性能测试(14 项)
npm run build      # 生产构建(manifold.wasm 作为静态资源打包)
npm run e2e        # headless Chrome 端到端(需本机装有 Chrome/Edge)
```

## 输入模型要求

manifold 需要**闭合、可定向、无自交**的二维流形网格。若导入报错"不是有效的二维流形",
请先用网格修复工具(如 MeshLab 的闭合孔洞、法线统一)预处理后再导入。
