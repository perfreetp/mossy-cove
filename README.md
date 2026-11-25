# 榫卯节点剖切标注工具

基于 **TypeScript + SolidJS + three.js + three-mesh-bvh** 的榫卯节点三维剖切与尺寸标注应用。
程序生成三构件咬合的透榫节点(立柱透榫眼 / 梁带榫头 / 木楔),无需外部模型文件即可运行。

## 功能

| 模块 | 说明 |
| --- | --- |
| 视口 | 程序化木纹材质(纤维条纹 + 木节),阴影、轨道控制器、地面网格 |
| 剖切 | X/Y/Z 三个可独立拖动的剖切面;手柄拖动或侧栏滑块驱动 |
| 截面轮廓 | BVH `shapecast` 遍历与平面相交的三角形,求三角面-平面交线后缝合成闭合环;earcut 三角化生成截面填充 |
| 标注 | 标注模式下在截面轮廓附近单击放置尺寸标注,两端点吸附轮廓;锚点存截面局部 2D 坐标,剖切面移动后重新求交吸附并更新数值;文字 Sprite 始终朝向屏幕且保持恒定屏幕尺寸 |
| 节点 | 每个构件可独立显隐;隐藏后剖切、轮廓、标注、测量仅在剩余构件上计算 |
| 测量 | 测量模式下在截面单击,沿截面内基向量发射 BVH 加速射线,量取榫头宽度(最外侧跨度)与榫眼深度(最大空腔),数值随剖切位置联动更新 |
| 持久化 | 剖切面状态、构件显隐、标注自动存入 `localStorage`;支持 JSON 导出分享与导入还原 |
| 历史 | 撤销/重做覆盖标注增删、剖切面移动、构件显隐(Ctrl+Z / Ctrl+Shift+Z) |
| 性能 | 拖动时截面重建与文字重绘按帧合并;300 标注下单次剖切重建约 4.5ms(见自测) |

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5180
```

## 测试

```bash
npm run test:logic     # Node 无头几何/BVH 算法测试(16 项)
npm run build          # 类型检查 + 生产构建
```

浏览器端全链路自检(需要先 `npm run dev`,并以 CDP 端口 9222 启动一个 Chromium 内核):

```bash
# Windows 示例
msedge --headless=new --remote-debugging-port=9222 --enable-unsafe-swiftshader about:blank
npm run test:browser   # 14 项:渲染、300 标注性能、撤销重做、导入导出、三面剖切
```

## 关键实现说明

- **精确剖切而非体素近似**:直接对原始三角面求平面交线。`intersectsBounds` 用 AABB 沿法线的投影半径判定并加 1e-6 容差(零厚度叶子盒体会被 `Plane.intersectsBox` 误剪枝);`intersectsTriangle` 必须始终返回 `false` —— three-mesh-bvh 的 shapecast 收到 `true` 会提前终止整树遍历。
- **环缝合**:交线顶点按 1e-5 量化去重,边键集合驱动邻接行走,支持孔环与 T 形交叉;有符号面积区分外环/孔环后交给 earcut。
- **标注锚点**:不存世界坐标,而存剖切面局部 (u, v),因此剖切面平移后可对新轮廓重新做最近边吸附,标注自然跟随。
- **测量射线**:从包围盒外射入,交点按距离排序后奇偶区间交替表示实体/空气;最大偶数区间即空腔深度。

## 目录结构

```
src/
  types.ts            共享类型与持久化文档格式
  store.ts            Solid store + 快照式撤销重做
  persistence.ts      localStorage / 导入导出
  App.tsx             SolidJS 界面(工具条、侧栏面板)
  three/
    bvh.ts            three-mesh-bvh 原型挂载
    joint.ts          程序榫卯几何与截面坐标系
    wood.ts           程序化木纹贴图与材质
    section.ts        BVH 剖切、环缝合、earcut 填充、轮廓吸附
    annotation.ts     尺寸标注视图与文字 Sprite 图层
    measure.ts        BVH 射线测量
    planeHandle.ts    可拖动剖切面手柄
    viewer.ts         场景编排与全部指针交互
test/
  smoke.ts            Node 无头算法测试
  cdp-runner.mjs      浏览器 CDP 自检
```
