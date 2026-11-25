# 青屿沙盘 · 植被散布工具

给微缩景观沙盘使用的植被散布工作台。原生 **TypeScript + Web Components（Shadow DOM）** 构建界面，
渲染层使用 **PixiJS 8 + pixi-viewport 7**，支持在程序化生成的沙盘地形上框选区域、
按密度 / 间距 / 乔灌比例散布数千个树木与灌木实例，并按地形高度与坡度自动稀疏。

![screenshot](screenshots/01-initial.png)

## 运行

```bash
npm install
npm run dev        # 本地开发（默认 http://127.0.0.1:5180）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建（http://127.0.0.1:4173）
npm run sanity     # 纯逻辑自检：散布约束 / 历史 / 擦除 / 序列化 / 性能
node scripts/browser-check.mjs   # 可选：用本机 Chrome 跑端到端验证
```

## 界面组成（对应需求的四个部分）

| 区域 | 自定义元素 | 功能 |
| --- | --- | --- |
| 画布视口 | `<viewport-canvas>` + `VegetationScene` | Pixi 画布、pixi-viewport 平移 / 缩放 / 捏合、地形、区域框、植被实例、擦除光标 |
| 散布参数面板 | `<scatter-panel>` | 密度三档、最小间距、乔灌比例、整片重撒、散布区域列表（定位 / 删除） |
| 高度带控制条 | `<height-band-control>` | 双滑块 + 高度直方图，限定保留的海拔区间 |
| 图层列表 | `<layer-list>` | 树木层 / 灌木层独立显隐、单独重撒，实例与对象池统计 |

顶部 `<veg-toolbar>` 提供工具切换（平移 / 划定区域 / 擦除）、三档笔刷半径、
撤销重做、JSON 导入导出。

## 操作

- **划定区域**：顶部选「划定区域」（快捷键 `R`），在地形上拖拽出矩形，松手即按当前参数散布。
- **平移 / 缩放**：平移工具下左键或右键拖拽，任意工具下滚轮缩放；快捷键 `V` 回到平移。
- **调参**：密度档位点击即整片重撒；间距 / 比例滑块拖动时实时重撒，松手合并为一条撤销记录。
- **高度带**：拖动左右两个滑块，区间外实例立即隐藏并回收到对象池，拉回后复用精灵重新显现。
- **擦除**：选「擦除」（`E`），`小 / 中 / 大` 三档半径（快捷键 `[` `]`），按住拖动局部清除；
  擦除会形成栅格掩码，之后任何重撒都会绕开被擦掉的位置。
- **图层**：眼睛开关单独隐藏树木 / 灌木；「重新散布本层」只更换该层种子并重算，另一层保留。
- **撤销 / 重做**：`Ctrl/Cmd+Z`、`Ctrl+Shift+Z` 或 `Ctrl+Y`。散布、调参、高度带、擦除、
  区域增删、图层显隐 / 重撒全部入栈（最多 80 条，保存完整状态快照）。
- **导出 / 导入**：「导出散布」下载带 `project` 信封的 JSON；「导入」恢复地形种子、区域、
  参数、高度带、擦除笔画与全部实例。

## 关键实现

- `src/core/terrain.ts`：确定性值噪声 + fBm 高度场（`Float32Array`），双线性高度 / 坡度采样、
  种植适宜度函数（水下、高海拔、陡坡为 0，过渡带概率稀疏）、初始宜居区域搜索。
- `src/core/scatter.ts`：抖动网格采样 + 空间哈希最小间距；树木 / 灌木采用不同间距系数，
  灌木生成时把树木哈希作为异层约束。单次全量重撒数千实例约 2–5 ms（Node 自测）。
- `src/core/erase-mask.ts`：6 px 栅格擦除掩码，重撒时 O(1) 查询，笔画再多也不退化。
- `src/core/store.ts`：单一状态源 + 快照式撤销重做；连续手势（拖滑块、擦除笔画）合并为一条历史。
- `src/pixi/VegetationScene.ts`：
  - 所有树木 / 灌木共享一张程序化生成的纹理图集，利于合批；
  - 每层一个精灵对象池，每次同步先整体归还再按需取用，实例 id 全量更新也能立即复用，
    精灵总数只随历史峰值增长、不随调参次数膨胀；
  - 高度带之外的实例不会被取用，即“隐藏并回收到池”。
- `src/pixi/atlas.ts` / `terrain-paint.ts`：全部贴图（植被图集、带山体阴影的地形位图）
  均为 Canvas 程序化绘制，无外部素材。

## 自动化调试钩子

页面挂载后可在控制台使用 `window.__VEG_TOOL__`：

```ts
__VEG_TOOL__.state            // 当前 ProjectState
__VEG_TOOL__.scene.getPoolStats()
__VEG_TOOL__.undo() / redo()
await __VEG_TOOL__.importJSON(text)
__VEG_TOOL__.exportJSON()
```

## 技术栈版本

PixiJS `^8.23`、pixi-viewport `^7.0`（peer 要求 pixi.js >= 8）、
TypeScript `~5.9`、Vite `^8`。
