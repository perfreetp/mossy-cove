# 云海地形生成器

一个面向动画天空背景的云海山地生成工具，使用 **TypeScript + Vue 3 + Babylon.js + Vite** 实现。可在地形面板生成连绵高度场，在云层面板叠加 2–4 层云带，使用俯视图笔刷编辑遮罩，并沿空中相机路径检查不同视角下的地形/云层层次。

## 启动

```bash
npm install
npm run dev
```

浏览器打开终端输出的地址（默认固定在 `127.0.0.1:5173`）。

生产构建：

```bash
npm run build
npm run preview
```

## 已实现功能

- **地形高度场**
  - 山脊高度、起伏频率、侵蚀强度参数。
  - 三档风格：平缓丘陵、连绵山脊、嶙峋高峰。
  - 固定种子的 Value Noise / FBM / Ridged Multifractal。
  - 轻量水力侵蚀、邻域平滑和分位数归一化。
  - `65 × 65` 高度采样，地形为 `64 × 64` 段，约 4,096 个四边形 / 8,192 个三角面。
- **多层云带**
  - 可添加/删除 2–4 层，每层有高度、厚度、覆盖率和云体浓度。
  - 每层由 3 片低成本云片组成，自定义 GLSL 噪声云材质。
  - 地形写入深度，云层开启深度测试；拖动云带高度后由 GPU 逐像素实时重算遮挡。
  - 透明云片由 Babylon.js 按相机距离从远到近排序，视角路径变化时层次自动重排。
  - 每层可单独隐藏，便于对比。
- **遮罩笔刷**
  - 地形俯视图使用高度场生成山体晕渲底图。
  - 可选择当前云带并独立编辑遮罩。
  - 支持绘制/擦除、笔刷大小、软硬边、填满、清空和反相。
  - 笔刷遮罩作为着色器纹理与程序云形、密度相乘，再与高度深度遮挡叠加。
- **视角联动**
  - 闭合 Catmull-Rom 空中相机路径和路径线/位置标记。
  - 可拖动路径进度、播放/暂停巡航、调节速度、显示/隐藏路径和重置视角。
  - 视角面板实时显示可见云带从远到近的距离顺序。
  - 主视口也支持 ArcRotateCamera 自由旋转、缩放和平移。
- **历史、存储和分享**
  - 地形与云层参数、增删层、显隐、笔刷笔画、导入等均进入整体撤销/重做栈。
  - 快捷键：`Ctrl/Cmd + Z` 撤销，`Ctrl/Cmd + Shift + Z` 或 `Ctrl + Y` 重做。
  - 项目自动保存到 `localStorage`。
  - 导出 JSON 文件包含版本信息、全部参数、行主序高度场和每层 Base64 遮罩。
  - 导入时会校验/补齐字段，然后可继续编辑、撤销或再次导出。

## 文件格式

导出文件的核心结构为：

```ts
interface ProjectFile {
  app: 'cloud-sea-terrain-generator'
  formatVersion: 1
  exportedAt: string
  project: {
    name: string
    heightResolution: 65
    maskResolution: 128
    terrain: {
      seed: number
      ridgeHeight: number
      frequency: number
      erosion: number
      style: 'rolling' | 'ridges' | 'alpine'
    }
    heights: number[] // 65 * 65，0..1，行主序
    bands: Array<{
      id: string
      name: string
      altitude: number
      thickness: number
      coverage: number
      density: number
      visible: boolean
      mask: string // Base64 的 128 * 128 灰度字节；空字符串表示全白
    }>
  }
}
```

## 主要目录

```text
src/
  babylon/          Babylon 场景管理、GLSL 着色器、Vue 到场景的桥接
  components/       Vue 面板、滑杆和俯视图笔刷编辑器
  io/               导出/导入文件
  state/            项目数据、历史栈、localStorage、视角状态
  terrain/          噪声、高度场/侵蚀、遮罩编码
  types.ts          共享数据类型
  constants.ts      分辨率、世界尺寸和范围常量
scripts/
  runtime-check.mjs 可选 Headless Chrome 冒烟/往返检查；先运行 npm run preview，再运行 npm run smoke
```

## 性能说明

- 地形参数中的山脊高度拖动只更新顶点/Y、法线和顶点色，不重新运行噪声。
- 频率和侵蚀使用 45ms 合并重算，避免每个 `input` 事件都执行侵蚀采样。
- 云带参数直接更新 uniform / 位置，不重建网格。
- 遮罩分辨率固定为 `128 × 128`，笔画过程中只上传一张小型 DynamicTexture。
- 默认硬件像素比限制到 1.6，并使用精简 Babylon 深路径导入。
