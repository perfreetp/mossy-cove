# 微缩沙盘建筑群布置工具

基于 **Vue 3 + TypeScript + Babylon.js + Vite** 的浏览器端微缩沙盘规划工具。建筑与街道数据自动保存在 `localStorage`，也可以导出/导入 JSON 文件进行分享。

## 启动

```bash
npm install
npm run dev
```

浏览器打开终端输出的地址（默认 http://127.0.0.1:5173）。

生产构建：

```bash
npm run build
npm run preview
```

## 已实现能力

- **四大界面区域**：场景、建筑库、街道编辑、导出/分享。
- **30 种固定档位体块**：
  - 住宅 10 档
  - 塔楼 10 档
  - 仓房 10 档
- 从建筑库卡片直接拖入 3D 场景。
- 落地按 **0.5 单位网格**吸附。
- 靠近已有建筑墙面时自动贴齐，并将朝向调整为与该墙面平行。
- 手动旋转按 **15°** 步进；快捷键 `R` / `Shift + R`。
- 吸附距离阈值可在场景顶部调节。
- 街道折线绘制、橙色手柄拖拽编辑。
- 建筑落在街道两侧吸附范围内时，自动朝向街道，并从道路边缘留出固定退距。
- 修改街道折线后，绑定该街道的两侧建筑按原 `u` 位置和侧别整体重排。
- 空白处拖拽框选多个建筑，支持：
  - 左/中/右、上/中/下对齐
  - 横向、纵向等距分布
  - 按角度或首个选中建筑统一朝向
- 选中一个或多个建筑后可替换为平屋顶、双坡顶、四坡顶。
- 初始示例沙盘包含 **96 个建筑、2 条街道**，适合验证 60–120 栋规模下的交互。
- 撤销/重做覆盖：
  - 放置
  - 移动
  - 旋转
  - 屋顶替换
  - 批量对齐/分布/朝向
  - 街道绘制与折线重排
  - 删除、复制、导入、清空等操作
- 自动写入浏览器 `localStorage`。
- 导出结构化 JSON，包含建筑坐标、尺寸、朝向（弧度和角度）、屋顶、街道绑定以及街道折点；同时支持导入该 JSON。

## 操作

| 操作 | 方式 |
| --- | --- |
| 添加建筑 | 从左侧卡片拖到场景 |
| 移动建筑 | 选择模式下左键拖动 |
| 多选 | 空白处左键拖框；`Shift + 点击` 增减选择 |
| 旋转 | `R` 顺时针 15°，`Shift + R` 逆时针 15°，或右侧面板 |
| 删除 | `Delete` / `Backspace` |
| 撤销/重做 | `Ctrl/Cmd + Z`、`Ctrl + Shift + Z` 或 `Ctrl + Y` |
| 绘制街道 | 街道编辑面板 → 绘制街道折线 → 单击加点 → 双击/按钮完成 |
| 编辑街道 | 拖动橙色折点 |
| 视角 | 滚轮缩放、右键平移、中键旋转；也可切换“视角模式”后左键旋转 |
| 取消绘制/选择 | `Esc` |

## 导出 JSON 结构示例

```json
{
  "app": "mini-sandbox-planner",
  "formatVersion": 1,
  "buildings": [
    {
      "id": "b_...",
      "defId": "residential-3",
      "name": "住宅 · 双坡民居",
      "category": "residential",
      "roof": "gable",
      "position": { "x": 12.5, "y": 0, "z": -4.0 },
      "dimensions": { "width": 5, "depth": 4.5, "height": 6 },
      "orientation": { "radians": 0.2618, "degrees": 15, "stepDegrees": 15 },
      "streetBinding": { "streetId": "street-main", "side": 1, "u": 0.32 },
      "x": 12.5,
      "z": -4.0,
      "width": 5,
      "depth": 4.5,
      "height": 6,
      "rotation": 0.2618,
      "rotationDegrees": 15
    }
  ],
  "streets": [
    {
      "id": "street-main",
      "name": "中央大道",
      "points": [{ "x": -54, "z": -2 }, { "x": -28, "z": -6 }],
      "width": 6,
      "setback": 2.5
    }
  ]
}
```

顶层也保留了扁平的 `x/z/width/depth/height/rotation` 字段，方便直接写脚本处理。

## 主要代码结构

```text
src/
├─ components/
│  ├─ LibraryPanel.vue      # 30 个建筑档位与拖拽源
│  ├─ SceneViewport.vue     # Canvas、快捷键、文件拖放、覆盖层
│  ├─ SelectionPanel.vue    # 单选/多选、对齐分布、屋顶替换
│  ├─ StreetPanel.vue       # 街道绘制与列表
│  └─ ExportPanel.vue       # JSON 导入导出、本地存档操作
├─ data/
│  ├─ library.ts            # 三类、30 个固定尺寸档位
│  └─ seed.ts               # 96 栋示例沙盘
├─ scene/
│  └─ SceneManager.ts       # Babylon 渲染、拾取、拖拽、框选、街道手柄
├─ state/
│  ├─ store.ts              # 响应式文档、历史栈、localStorage
│  └─ drag.ts               # 原生拖放共享状态
├─ utils/
│  ├─ geometry.ts           # 网格、OBB、墙面/街道吸附、折线几何
│  └─ io.ts                 # JSON 序列化、校验和导入归一化
└─ types.ts
```

## 性能说明

建筑均为低多边形 Box/自定义坡顶网格，共享少量材质状态，没有引入重量级后处理；96 个初始建筑通常只有约 200 个可见网格。选择高亮使用单个 `HighlightLayer`，街道编辑仅重建对应街道组，拖拽过程中直接更新节点变换，提交时才写入撤销栈。
