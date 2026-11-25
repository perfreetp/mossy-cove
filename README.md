# Cloud Ridge Studio · 程序化云层与地形生成工具

用于生成「带云层环绕的山地背景」的程序化场景编辑器。技术栈 **TypeScript + Svelte 4 + Babylon.js 7 + Vite**，零外部美术资源，地形、云层、纹理全部程序生成。

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 生产构建到 dist/
npm run preview    # 预览生产构建
npm run check      # svelte-check 严格类型检查
npm test           # 纯逻辑冒烟测试
npm run test:all   # 冒烟 + 序列化往返测试
```

浏览器端到端检查（需系统已安装 Chrome，会以 SwiftShader 软件渲染跑无头浏览器）：

```bash
npm run build && npm run preview   # 终端 A
node scripts/browser-check.mjs     # 终端 B
```

## 功能清单

### 地形（高度场噪声）
- 种子化梯度值噪声 + fBm + ridged 脊线变换，确定性可复现。
- 三个滑杆：**山脊起伏**（落差）、**破碎度**（高频层数与锐度）、**基准高度**（整体抬升）。
- 默认 192×192 网格 ≈ **3.7 万顶点**，顶点色按海拔/坡度混合草甸、泥土、岩壁、雪线。
- 「重新生成地形」换种子。

### 笔刷
- 抬升 / 压低两种模式，半径（4–60m）与强度（1–20）可调。
- 位移写入独立 128×128 笔刷图，双线性采样叠加到基础高度场。
- 局部刷新：仅重算影响矩形的位置/法线/顶点色，并通过 `bufferSubData` 做 GPU 局部上传，不全量重传缓冲。
- 笔刷修改后云团贴合高度与云影范围自动重算；一整笔笔画作为单条撤销记录。

### 云层
- 沿山脊评分加权采样自动环绕分布，数量 4–80 可调，可重新分布/手动新增。
- 每个云团三档参数：**密度**（绒球数）、**厚度**（堆叠层数）、**高度**（悬浮距离）。
- 全局「地形贴合程度」滑杆控制整体悬浮高度。
- 云团可点选、拖拽；拖拽时对相邻云团做多轮松弛 + 硬投影，强制最小间距。
- 云影为地面半透明贴片，方位/长度/浓度随太阳高度角联动。
- 云团列表支持单独显隐与锁定（锁定后不可拖拽）。

### 光照
- 清晨 / 正午 / 黄昏三套预设，切换时太阳方位、高度角、光色、雾、天空在 0.6s 内平滑补间。
- 云团明暗与地面投影方向同步更新。

### 历史 / 持久化 / 分享
- 撤销重做（80 步）覆盖：笔刷、云团拖拽、档位调整、数量/分布、贴合度、地形参数、种子、增删云团。
- 滑杆类操作「拖动实时预览、松手提交一条记录」。
- 自动保存到 `localStorage`（500ms 防抖）。
- 导出/导入 JSON 场景文件用于分享，含格式校验与可读错误提示。

## 架构

```
src/
├─ lib/            纯逻辑，无 DOM/Babylon 依赖，可单测
│  ├─ noise.ts       地形噪声模型 + 笔刷位移图
│  ├─ clouds.ts      云团模型、山脊分布、间距求解
│  ├─ lighting.ts    三套光照预设
│  ├─ history.ts     命令式撤销栈
│  ├─ storage.ts     序列化 / localStorage / 文件导入导出
│  ├─ textures.ts    Canvas 程序化贴图（云团、云影、笔刷光标）
│  └─ mathUtils.ts   数学工具与种子随机
├─ babylon/        渲染层
│  ├─ terrainMesh.ts 地形网格与局部缓冲上传
│  ├─ cloudLayer.ts  云团 billboard、云影、选中环
│  └─ sceneEngine.ts 场景装配、相机光照、指针交互、补间
├─ components/     Svelte UI 面板
├─ editor.ts       中央控制器（store、历史、持久化编排）
└─ App.svelte      布局与快捷键
```

分层约定：`lib/` 不依赖 Babylon；`babylon/` 只负责渲染与拾取，业务状态由 `editor.ts` 持有；Svelte 组件通过聚合 store `editorView` 订阅状态、通过 `editor` 单例调用动作。

## 快捷键

| 按键 | 功能 |
| --- | --- |
| `B` | 笔刷模式 |
| `V` | 云团拖拽模式 |
| `Esc` | 回到视角模式 / 取消选中 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做（`Ctrl+Shift+Z` 同为重做） |
| `Delete` | 删除选中云团 |
