# 古生物骨骼装配与姿态复原工作台

基于 **TypeScript + React 18 + three.js + three-mesh-bvh** 的三维骨骼装配工具，
以一具兽脚类恐龙（霸王龙式）骨架为演示对象，支持拖入装配、关节联动、镜像对称、
剖面裁切、地面吸附与完整的撤销重做。

## 运行

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5180
npm run build      # 类型检查 + 生产构建
npm run selftest   # 31 项逻辑自测 + 性能基准（纯 Node，无需浏览器）
```

## 操作指南

| 操作 | 方式 |
| --- | --- |
| 装配骨骼 | 从左侧骨骼库拖动骨骼件到场景，自动吸附到最近的兼容空闲插槽并建立父子层级 |
| 选中骨骼 | 单击骨骼；选中后显示红绿蓝局部坐标轴手柄（X/Y/Z） |
| 旋转关节 | 拖动手柄轴，在过关节中心且垂直于该轴的平面上绕轴旋转 |
| 极限约束 | 旋转超出关节活动角时停在极限位置，骨骼红色高亮、姿态面板对应输入框标红 |
| 脊柱联动 | 旋转脊柱链任一节，下游全部骨骼通过 FK 层级自动跟随 |
| 镜像复制 | 选中单侧骨骼点「镜像复制」，整棵肢体子树反射到对侧 |
| 镜像同步 | 右侧面板开关；开启后旋转/输入任一侧，对侧按 `(+x,-y,-z)` 自动联动 |
| 姿态回写 | 右侧面板列出全部关节角度（度），可直接输入数值回写场景（同样受极限钳制） |
| 地面吸附 | 开关开启后足部（跖骨/掌骨）最低点贴合起伏地形 |
| 整体平移 | 顶栏切到「整体平移」模式，拖手柄在面向相机的平面上移动整具骨架 |
| 剖面模式 | 开启后沿平面裁切，只显示法线一侧；可切换法线方向、拖动青色平面调整位置 |
| 导入导出 | 顶栏按钮，JSON 格式保存骨骼层级 + 姿态 + 根变换 + 工具设置 |
| 撤销重做 | `Ctrl+Z` / `Ctrl+Y`（或顶栏按钮），覆盖拖入、旋转、镜像、吸附、裁切等全部操作 |
| 删除 | `Delete` 键级联删除子树 |

## 架构

```
src/
├── types.ts                  数据模型（模板/插槽/实例/项目快照）
├── lib/
│   ├── math3d.ts             纯数学：角度钳制、镜像欧拉、深拷贝（可单测）
│   ├── catalog.ts            19 个骨骼模板（含自动镜像的 R 侧）与插槽定义
│   ├── kinematics.ts         正向运动学：层级世界矩阵、最近插槽查询、贴地数学
│   ├── mirror.ts             子树镜像复制、镜像伙伴查找
│   ├── terrain.ts            起伏地形高度函数与网格
│   └── demoSkeleton.ts       程序化生成 202 块骨骼的完整演示骨架
├── store/
│   └── skeletonStore.ts      快照式撤销/重做状态机（useSyncExternalStore）
├── three/
│   ├── geometryFactory.ts    每模板一份共享 BufferGeometry + 预建 BVH
│   ├── TransformGizmo.ts     自定义局部坐标轴旋转/平移手柄
│   ├── ClipPlaneWidget.ts    可拖动剖面平面
│   └── SceneManager.ts       渲染、拾取、DnD 落点、交互编排、裁切、贴地
├── ui/                       React 面板（骨骼库/姿态面板/顶栏/视口）
└── test/                     逻辑自测与性能基准
```

## 关键设计决策

### 撤销重做：整快照而非反向命令
每次离散操作前深拷贝整个 `ProjectData`（纯 JSON，202 块约 150KB）压栈。
连续拖拽用 `beginInteraction` 记录检查点、`applyLive` 实时更新、
`endInteraction(label)` 一次性入账或丢弃。单次撤销精确还原操作前状态，
无需为每种操作编写逆运算，覆盖拖入/旋转/镜像/吸附/裁切等所有路径。

### 性能：几何共享 + BVH + 引用缓存
- 每种模板只建一份 `BufferGeometry` 并预计算 BVH，202 个实例共享，拾取走加速射线检测；
- FK 每帧全量重算 202 块实测约 **0.48ms**（60fps 预算 16.7ms）；
- `syncFromStore` 用项目引用缓存，React 重渲染不触发重复 FK；
- 拖动期间只更新矩阵，不创建/销毁对象。

### 镜像数学
反射面为矢状面 `S=diag(-1,1,1)`。R 侧模板几何的顶点已做 x 反射，
关节姿态映射经端到端层级数值验证为欧拉角 `(+x,-y,-z)`（屈伸同向、收展扭转反向），
保证 R 侧世界网格严格满足 `rightJoint·S = S·leftJoint`。
插槽 id 按 `L/R` 后缀互换（如 `ribL → ribR`）。

### 关节极限
每模板定义 XYZ 三轴 `[min,max]`，`null` 表示该轴锁定。
手柄拖动与面板输入共用 `clampRotation`，命中极限的轴驱动红色高亮。

## 数据格式（导出 JSON）

```json
{
  "version": 1,
  "bones": [
    {
      "id": "femur:L#1",
      "templateBaseId": "femur",
      "side": "L",
      "parentId": "ilium:L#1",
      "parentSlotId": "hip",
      "localPos": [0, 0, 0],
      "rotation": [0.31, 0, -0.14]
    }
  ],
  "rootTransform": { "pos": [0, 1.4, 0], "rot": [0, 0, 0] },
  "settings": {
    "groundSnap": false,
    "clip": { "enabled": false, "pos": [0, 0, 0], "normal": [1, 0, 0] }
  }
}
```
