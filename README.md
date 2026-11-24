# 展台焕颜 BoothBrand Studio

基于 **Vue 3 + TypeScript + Konva + opentype.js + Three.js** 的发布会展台外观预演工具。工具按照“展台模型 → 材质配色 → 文字排布 → 方案交付”四个步骤串联，展开图与三维视图同屏联动。

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 已实现能力

- **4 套展台外形**：线性展台、L 形转角、岛台、T 台；当前模型分别生成约 40–67 个墙面板、顶面模块、接待台、展柜和品牌柱表面。
- **展开图平铺**：所有面按真实宽高比例和自动换行布局平铺在 Konva 画布中，支持滚轮缩放、拖拽平移、一键适配。
- **材质库**：18 种自带品牌色、金属、木纹、混凝土、亚克力、灯箱和 LED 材质预设。
- **双向选择高亮**：点击 Konva 展开面或 Three.js 三维面，同一 `selectedFaceId` 会驱动两侧高亮；悬停也会联动。
- **配色双视图同步**：材质写入响应式方案数据，Konva 与 Three.js 同时更新。
- **品牌文字轮廓**：opentype.js 读取本地 Montserrat / Noto Sans SC 字体，按字号、字距、行高、加粗重新生成真实字形路径；中文会自动回退到 Noto。
- **拖动与吸附**：文字块可在展开图中拖动，自动吸附立面中线和边界；位置以面内归一化坐标保存。
- **边界检查**：根据字形真实包围盒计算水平/垂直溢出，展开图显示红色虚线，三维对应面边缘同步变红，面板给出溢出尺寸。
- **一键贴合边界**：二分计算最大可用字号并居中。
- **三套方案槽**：A/B/C 可保存完整快照并反复切换；模型 ID、每面材质、文字参数和归一化位置均精确还原。
- **导入/导出**：可导出当前方案 JSON，也可导出包含三个方案槽和当前草稿的完整备份包；导入时做字段清洗和面 ID 校验。
- **本地自动缓存**：工作状态自动存入 `localStorage`。
- **性能取向**：数十个 Konva 面和十几个文字块直接渲染；文字轮廓按参数签名缓存，三维文字贴图按面合并并通过 `requestAnimationFrame` 合并刷新。

## 目录说明

```text
src/
  components/
    UnfoldedCanvas.vue   # Konva 展开图、文字拖拽、吸附和边界提示
    ThreePreview.vue     # Three.js 三维视图、射线选择和文字贴图
    ModelPanel.vue       # 模块一：展台外形
    MaterialPanel.vue    # 模块二：材质库和面列表
    TextPanel.vue        # 模块三：文字属性和边界操作
    SchemePanel.vue      # 模块四：三套方案与导入导出
  data/
    booths.ts            # 展台拓扑、三维角点、展开布局生成
    materials.ts         # 内置材质配色库
  services/
    fonts.ts             # 字体加载和 opentype 轮廓/字距计算
    outlines.ts          # 轮廓缓存与边界计算
    store.ts             # 响应式状态、方案槽、持久化、导入导出
  types.ts
public/fonts/            # 本地内置开源字体
```

## 方案 JSON 核心结构

```ts
interface Scheme {
  schema: 'booth-brand-scheme'
  schemaVersion: 1
  name: string
  modelId: string
  assignments: Record<string, string> // faceId -> materialId
  texts: Array<{
    id: string
    faceId: string
    content: string
    fontId: 'noto' | 'montserrat'
    nx: number // 面内横向中心，0–1
    ny: number // 面内纵向中心，0–1
    fontSize: number
    letterSpacing: number
    lineHeight: number
    color: string
    bold: boolean
  }>
  updatedAt: string
}
```

## 浏览器冒烟检查

`scripts/smoke.mjs` 提供了基于 Puppeteer Core 和本机 Chrome 的验收脚本，覆盖：

- 画布与三维场景启动；
- 4 套模型构建；
- 材质写入；
- 加入 12 个压测文字块；
- 真实 Konva 指针拖拽；
- A/B 方案保存和双向切换的精确值校验；
- JSON 备份包导入/导出；
- 刷新后本地缓存恢复。

该脚本是可选开发工具，需要另行提供 `puppeteer-core` 与可执行的 Chrome 路径。
