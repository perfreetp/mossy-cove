# 微缩沙盘地形雕刻工具

基于 **TypeScript + React + Three.js** 的浏览器地形雕刻与建筑布置工具。高度场、建筑、水位、岩层分界和剖切状态会自动保存到 `localStorage`，也可以导出为 JSON 文件分享或重新导入。

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

## 功能

- 可调分辨率网格高度场：`64 / 128 / 256 / 384 / 512`，默认 **256 格边长（257² 顶点）**。
- 四种笔刷：抬升、下压、平滑、抹平；半径和力度可调。
- 拖动时只计算笔刷包围盒内的高度与法线，并按行上传 `BufferAttribute.updateRanges`；松开指针后整片重算法线、统计等高距、剖面和建筑贴合。
- 高度分档地形着色，精确生成 **6 条自动间距等高线**；等高距为当前高度范围的 `1/6`。
- 水位滑块与透明水面，低洼地形会被水面覆盖。
- `X / Y / Z` 三个方向剖切平面，剖切面上生成地表以下 **5 层岩层色带**；4 个高度分界可拖动调整厚度。
- 20–40 栋程序化建筑群，也可进入放置模式点击地形添加。建筑通过 `InstancedMesh` 渲染，使用双线性高度采样吸附地表，并在雕刻包围盒内实时升降。
- 撤销/重做覆盖笔刷 stroke、建筑添加、生成、删除、清空和压测实例。
- 导出包含 `resolution`、一维行优先 `heightField`、`buildings`、水位、岩层和剖切配置的 JSON；支持重新导入校验。
- 可选性能压测按钮会追加 1000 个实例，实例上限为 5000。

## 操作

| 操作 | 方式 |
| --- | --- |
| 雕刻 / 放置建筑 | 鼠标左键在地形上拖动或点击 |
| 旋转视角 | 鼠标右键拖动 |
| 平移视角 | 鼠标中键拖动 |
| 缩放 | 滚轮 |
| 撤销 / 重做 | 顶栏按钮 |

## JSON 结构示例

```json
{
  "format": "micro-sandbox-terrain",
  "version": 1,
  "name": "示例沙盘",
  "resolution": 256,
  "cellSize": 0.09375,
  "heightField": [0.72, 0.71],
  "buildings": [
    {
      "id": "b_...",
      "x": 1.2,
      "z": -0.4,
      "width": 0.9,
      "depth": 1.1,
      "height": 2.4,
      "rotation": 0,
      "color": "#4c78a8"
    }
  ],
  "waterLevel": 0.55,
  "strataBoundaries": [-4.05, -2.9, -1.75, -0.65],
  "sections": { "xEnabled": true, "yEnabled": false, "zEnabled": true, "x": 2.2, "y": -2.25, "z": 2.2 }
}
```

`heightField` 长度必须为 `(resolution + 1)²`，按 `z` 行、`x` 列的一维行优先顺序存储。

## 主要代码

- `src/terrain/SandboxEngine.ts`：Three.js 场景、指针雕刻、历史、持久化和 React 状态源。
- `src/terrain/terrainGeometry.ts`：网格创建、局部法线和局部缓冲区上传。
- `src/terrain/terrainMaterial.ts`：高度分档与 6 级等高线 shader。
- `src/terrain/sections.ts`：三向剖面和五层岩层几何。
- `src/terrain/project.ts`：JSON 校验、导入导出和 localStorage。
- `src/components/`：笔刷、剖切、导出和视口界面。
