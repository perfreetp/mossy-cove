// Babylon.js 渲染与交互引擎：持有权威场景数据，拖拽过程中帧内实时重算遮挡
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Quaternion, Color3, Color4, TmpVectors } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { GridMaterial } from '@babylonjs/materials/grid';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {
  BallisticPoint,
  EngineStatus,
  GizmoMode,
  ModelAsset,
  Obstacle,
  PointType,
  ProjectData,
  ToolMode,
  Trajectory,
  Vec3,
} from '../types';
import {
  basisFromDir,
  computeOcclusions,
  dist,
  fitTrajectory,
  HashGrid,
  normalize,
  OBB,
  sampleAt,
  sub,
  uid,
} from '../lib/math';

const TUBE_TESSELLATION = 12;
const SEG_TESSELLATION = 8;
const SEG_PATH_POINTS = 41;
const GRID_CELL = 3;

export interface Selection {
  kind: 'point' | 'obstacle' | 'trajectory' | null;
  id: string | null;
}

export interface EngineSnapshot {
  points: BallisticPoint[];
  obstacles: Obstacle[];
  trajectories: Trajectory[];
  activeTrajectoryId: string | null;
  selection: Selection;
  status: EngineStatus;
}

type SnapshotListener = (s: EngineSnapshot) => void;

interface PointNode {
  data: BallisticPoint;
  root: TransformNode;
  sphere: Mesh;
  arrow: TransformNode;
  material: StandardMaterial;
}

interface ObstacleNode {
  data: Obstacle;
  root: Mesh;
  content: TransformNode[];
  material: StandardMaterial | null;
  baseEmissive: Color3;
}

interface TrajView {
  data: Trajectory;
  tube: Mesh | null;
  material: StandardMaterial;
  /** 遮挡段红管对象池 */
  segPool: Mesh[];
  segPoolMat: StandardMaterial;
  /** 遮挡位置标记球对象池（每段入/出各一个） */
  markerPool: Mesh[];
  markerMatIn: StandardMaterial;
  markerMatOut: StandardMaterial;
}

const POINT_COLORS: Record<PointType, Color3> = {
  entry: new Color3(0.1, 0.85, 0.35),
  exit: new Color3(0.9, 0.2, 0.15),
  constraint: new Color3(0.95, 0.65, 0.1),
};

export class BallisticEngine {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private utilLayer: UtilityLayerRenderer;
  private posGizmo: PositionGizmo;
  private rotGizmo: RotationGizmo;

  private data: ProjectData;
  private pointNodes = new Map<string, PointNode>();
  private obstacleNodes = new Map<string, ObstacleNode>();
  private trajViews = new Map<string, TrajView>();
  private listeners = new Set<SnapshotListener>();

  toolMode: ToolMode = 'select';
  gizmoMode: GizmoMode = 'position';
  private selection: Selection = { kind: null, id: null };
  private dragging = false;
  private lastOcclusionMs = 0;
  private statusTimer: number | null = null;
  private grid = new HashGrid(GRID_CELL);

  constructor(canvas: HTMLCanvasElement, data: ProjectData) {
    this.data = data;
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.07, 0.09, 0.12, 1);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2.4, Math.PI / 3, 18, new Vector3(0, 1, 0), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 20;
    this.camera.lowerRadiusLimit = 1.5;
    this.camera.upperRadiusLimit = 120;
    this.camera.panningSensibility = 60;
    this.camera.minZ = 0.05;

    new HemisphericLight('hemi', new Vector3(0.4, 1, 0.6), this.scene);
    const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.4), this.scene);
    dir.intensity = 0.7;

    this.buildGround();
    this.utilLayer = new UtilityLayerRenderer(this.scene);
    this.posGizmo = new PositionGizmo(this.utilLayer, 3);
    this.rotGizmo = new RotationGizmo(this.utilLayer);
    this.posGizmo.onDragStartObservable.add(() => this.beginDrag());
    this.rotGizmo.onDragStartObservable.add(() => this.beginDrag());
    this.posGizmo.onDragEndObservable.add(() => this.endDrag());
    this.rotGizmo.onDragEndObservable.add(() => this.endDrag());

    this.scene.onBeforeRenderObservable.add(() => this.frameTick());
    this.scene.onPointerObservable.add((info) => this.onTap(info));

    this.rebuildAll();
    this.engine.runRenderLoop(() => this.scene.render());
    this.statusTimer = window.setInterval(() => this.emitSnapshot(), 500);
  }

  // ---------- 场景基础 ----------
  private buildGround(): Mesh {
    const g = MeshBuilder.CreateGround('ground', { width: 100, height: 100, subdivisions: 2 }, this.scene);
    const mat = new GridMaterial('gridMat', this.scene);
    mat.majorUnitFrequency = 5;
    mat.minorUnitVisibility = 0.35;
    mat.gridRatio = 1;
    mat.mainColor = new Color3(0.11, 0.13, 0.17);
    mat.lineColor = new Color3(0.35, 0.55, 0.7);
    mat.opacity = 0.98;
    g.material = mat;
    g.metadata = { kind: 'ground' };
    g.isPickable = true;
    return g;
  }

  // ---------- 数据访问 ----------
  getProjectData(): ProjectData {
    return structuredClone(this.data);
  }

  subscribe(fn: SnapshotListener): () => void {
    this.listeners.add(fn);
    fn(this.buildSnapshot());
    return () => this.listeners.delete(fn);
  }

  private buildSnapshot(): EngineSnapshot {
    return {
      points: structuredClone(this.data.points),
      obstacles: structuredClone(this.data.obstacles),
      trajectories: structuredClone(this.data.trajectories),
      activeTrajectoryId: this.data.activeTrajectoryId,
      selection: { ...this.selection },
      status: {
        fps: Math.round(this.engine.getFps()),
        obstacleCount: this.data.obstacles.length,
        pointCount: this.data.points.length,
        lastOcclusionMs: Math.round(this.lastOcclusionMs * 100) / 100,
        saved: false,
      },
    };
  }

  private emitSnapshot(): void {
    const s = this.buildSnapshot();
    this.listeners.forEach((fn) => fn(s));
  }

  // ---------- 全量重建（载入项目 / 重置） ----------
  private rebuildAll(): void {
    for (const v of this.trajViews.values()) this.disposeTrajView(v);
    this.trajViews.clear();
    for (const n of this.pointNodes.values()) n.root.dispose();
    this.pointNodes.clear();
    for (const n of this.obstacleNodes.values()) n.root.dispose();
    this.obstacleNodes.clear();
    for (const o of this.data.obstacles) this.buildObstacleNode(o);
    for (const p of this.data.points) this.buildPointNode(p);
    for (const t of this.data.trajectories) this.buildTrajView(t);
    this.recomputeAll(true);
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  loadProject(data: ProjectData): void {
    this.data = data;
    this.selection = { kind: null, id: null };
    this.detachGizmo();
    this.rebuildAll();
  }

  reset(): void {
    this.detachGizmo();
    this.data = emptyProject();
    this.selection = { kind: null, id: null };
    this.rebuildAll();
  }

  // ---------- 标注点 ----------
  private buildPointNode(p: BallisticPoint): void {
    const root = new TransformNode(`point_${p.id}`, this.scene);
    root.position = toV3(p.position);
    root.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), toV3(normalize(p.direction)), new Quaternion());

    const sphere = MeshBuilder.CreateSphere(`sphere_${p.id}`, { diameter: 0.3, segments: 12 }, this.scene);
    sphere.parent = root;
    sphere.metadata = { kind: 'point', id: p.id };
    const mat = new StandardMaterial(`pointMat_${p.id}`, this.scene);
    mat.diffuseColor = POINT_COLORS[p.type].scale(0.4);
    mat.emissiveColor = POINT_COLORS[p.type];
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    sphere.material = mat;

    const arrow = new TransformNode(`arrow_${p.id}`, this.scene);
    arrow.parent = root;
    const shaft = MeshBuilder.CreateCylinder(`shaft_${p.id}`, { height: 0.34, diameter: 0.09 }, this.scene);
    shaft.parent = arrow;
    shaft.position.y = 0.24;
    const head = MeshBuilder.CreateCylinder(`head_${p.id}`, { height: 0.16, diameterTop: 0, diameterBottom: 0.2 }, this.scene);
    head.parent = arrow;
    head.position.y = 0.49;
    for (const m of [shaft, head]) {
      m.material = mat;
      m.metadata = { kind: 'point', id: p.id };
    }

    this.pointNodes.set(p.id, { data: p, root, sphere, arrow, material: mat });
  }

  addPoint(type: PointType, position?: Vec3): BallisticPoint {
    const seq = this.data.points.filter((p) => p.type === type).length + 1;
    const labelMap = { entry: '射入点', exit: '射出点', constraint: '约束点' } as const;
    const pos: Vec3 = position ?? [0, 1.2, 0];
    let dir: Vec3;
    if (type === 'entry') {
      const exit = this.data.points.find((p) => p.type === 'exit');
      dir = exit ? normalize(sub(exit.position, pos)) : [0, 0, 1];
    } else if (type === 'exit') {
      const entry = this.data.points.find((p) => p.type === 'entry');
      dir = entry ? normalize(sub(pos, entry.position)) : [0, 0, 1];
    } else {
      dir = [0, 0, 1];
    }
    const p: BallisticPoint = {
      id: uid('pt'),
      type,
      label: `${labelMap[type]} ${seq}`,
      position: pos,
      direction: dir,
    };
    this.data.points.push(p);
    this.buildPointNode(p);
    // 约束点自动加入所有弹道（插在射出点之前）
    if (type === 'constraint') {
      for (const t of this.data.trajectories) {
        const idx = t.pointIds.length > 0 ? t.pointIds.length - 1 : 0;
        t.pointIds.splice(idx, 0, p.id);
      }
    }
    this.recomputeAll(true);
    this.select({ kind: 'point', id: p.id });
    this.emitSnapshot();
    return p;
  }

  updatePoint(id: string, patch: Partial<Pick<BallisticPoint, 'position' | 'direction' | 'label'>>): void {
    const p = this.data.points.find((x) => x.id === id);
    const node = this.pointNodes.get(id);
    if (!p || !node) return;
    if (patch.label !== undefined) p.label = patch.label;
    if (patch.position) {
      p.position = [...patch.position] as Vec3;
      node.root.position = toV3(p.position);
    }
    if (patch.direction) {
      p.direction = normalize([...patch.direction] as Vec3);
      node.root.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
        Vector3.Up(),
        toV3(p.direction),
        new Quaternion(),
      );
    }
    this.recomputeAll(true);
    this.emitSnapshot();
  }

  removePoint(id: string): void {
    const node = this.pointNodes.get(id);
    if (!node) return;
    if (this.selection.id === id) this.detachGizmo();
    node.root.dispose();
    this.pointNodes.delete(id);
    this.data.points = this.data.points.filter((p) => p.id !== id);
    for (const t of this.data.trajectories) t.pointIds = t.pointIds.filter((x) => x !== id);
    // 点不足 2 个的弹道无法拟合，连同渲染视图一起销毁，避免孤儿网格
    for (const t of [...this.data.trajectories]) {
      if (t.pointIds.length < 2) {
        const view = this.trajViews.get(t.id);
        if (view) {
          this.disposeTrajView(view);
          this.trajViews.delete(t.id);
        }
      }
    }
    this.data.trajectories = this.data.trajectories.filter((t) => t.pointIds.length >= 2);
    if (!this.data.trajectories.find((t) => t.id === this.data.activeTrajectoryId)) {
      this.data.activeTrajectoryId = this.data.trajectories[0]?.id ?? null;
    }
    this.recomputeAll(true);
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  // ---------- 障碍物 ----------
  private buildObstacleNode(o: Obstacle): void {
    const root = MeshBuilder.CreateBox(`ob_${o.id}`, {
      width: o.halfExtents[0] * 2,
      height: o.halfExtents[1] * 2,
      depth: o.halfExtents[2] * 2,
    }, this.scene);
    root.position = toV3(o.position);
    root.rotationQuaternion = Quaternion.FromEulerAngles(o.rotation[0], o.rotation[1], o.rotation[2]);
    root.metadata = { kind: 'obstacle', id: o.id };

    const mat = new StandardMaterial(`obMat_${o.id}`, this.scene);
    const c = Color3.FromHexString(o.color);
    mat.diffuseColor = c.scale(0.5);
    mat.emissiveColor = c.scale(0.12);
    mat.alpha = o.kind === 'box' ? 0.85 : 0.95;
    root.material = mat;

    this.obstacleNodes.set(o.id, {
      data: o,
      root,
      content: [],
      material: mat,
      baseEmissive: c.scale(0.12),
    });
  }

  addBox(position?: Vec3, halfExtents?: Vec3): Obstacle {
    const seq = this.data.obstacles.filter((o) => o.kind === 'box').length + 1;
    const o: Obstacle = {
      id: uid('ob'),
      kind: 'box',
      name: `长方体 ${seq}`,
      position: position ?? [0, 1, 0],
      rotation: [0, 0, 0],
      halfExtents: halfExtents ?? [1, 1, 1],
      color: '#4f86c6',
      visible: true,
    };
    this.data.obstacles.push(o);
    this.buildObstacleNode(o);
    this.recomputeAll(false);
    this.select({ kind: 'obstacle', id: o.id });
    this.emitSnapshot();
    return o;
  }

  /** 性能压测：批量放置 N 个长方体 */
  addStressBoxes(n: number): void {
    const cols = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * 2.4 - cols * 1.2;
      const z = Math.floor(i / cols) * 2.4 - cols * 1.2;
      this.addBox([x, 1, z], [0.9 + (i % 3) * 0.2, 1, 0.9]);
    }
    this.emitSnapshot();
  }

  /** 导入 GLB 空间模型：实测包围盒并归一化到最长边 4 单位，以其 OBB 参与遮挡检测 */
  async addModel(asset: ModelAsset): Promise<Obstacle> {
    const o: Obstacle = {
      id: uid('ob'),
      kind: 'model',
      name: asset.name,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      halfExtents: [1, 1, 1],
      color: '#8a7fd0',
      assetId: asset.id,
      visible: true,
    };

    // 先加载模型，测量并归一化包围盒。
    // data URL 直连走 glTF 插件 directLoad 时 magic 字符串匹配脆弱，
    // 解码为标准 Uint8Array 后用新版选项 API 以 rawData 加载，
    // pluginExtension=.glb 强制二进制 glTF 加载器。
    // 先加载模型，测量并归一化包围盒。
    // data URL 直连在 glTF 插件 directLoad/rawData 路由上有版本相关的脆弱性，
    // 这里包装成带 .glb 文件名的 File：加载器按 isFile 分支 + 扩展名确定性走二进制路径。
    const bytes = dataUrlToBytes(asset.dataUrl);
    const file = new File([bytes], `${asset.id}.glb`, { type: 'model/gltf-binary' });
    const result = await ImportMeshAsync(file, this.scene, {
      pluginExtension: '.glb',
    });
    let mn = new Vector3(Infinity, Infinity, Infinity);
    let mx = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of result.meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo()?.boundingBox;
      if (!bb) continue;
      mn = Vector3.Minimize(mn, bb.minimumWorld);
      mx = Vector3.Maximize(mx, bb.maximumWorld);
    }
    const center = mn.add(mx).scale(0.5);
    const size = mx.subtract(mn);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const normScale = 4 / longest;
    o.halfExtents = [
      (size.x * normScale) / 2,
      (size.y * normScale) / 2,
      (size.z * normScale) / 2,
    ];

    this.data.obstacles.push(o);
    this.data.assets.push(asset);
    this.buildObstacleNode(o);
    const node = this.obstacleNodes.get(o.id)!;
    node.material!.alpha = 0; // 根盒仅作拾取代理，不显示

    const group = new TransformNode(`model_${o.id}`, this.scene);
    for (const m of result.meshes) {
      m.parent = group;
      m.metadata = { kind: 'obstacle', id: o.id };
    }
    group.parent = node.root;
    group.scaling = new Vector3(normScale, normScale, normScale);
    group.position = center.scale(-normScale);
    node.content.push(group);

    this.recomputeAll(false);
    this.select({ kind: 'obstacle', id: o.id });
    this.emitSnapshot();
    return o;
  }

  updateObstacle(id: string, patch: Partial<Pick<Obstacle, 'position' | 'rotation' | 'name' | 'color' | 'visible'>>): void {
    const o = this.data.obstacles.find((x) => x.id === id);
    const node = this.obstacleNodes.get(id);
    if (!o || !node) return;
    if (patch.name !== undefined) o.name = patch.name;
    if (patch.color !== undefined) {
      o.color = patch.color;
      const c = Color3.FromHexString(o.color);
      if (node.material) {
        node.material.diffuseColor = c.scale(0.5);
        node.baseEmissive = c.scale(0.12);
      }
    }
    if (patch.visible !== undefined) {
      o.visible = patch.visible;
      node.root.setEnabled(o.visible);
    }
    if (patch.position) {
      o.position = [...patch.position] as Vec3;
      node.root.position = toV3(o.position);
    }
    if (patch.rotation) {
      o.rotation = [...patch.rotation] as Vec3;
      node.root.rotationQuaternion = Quaternion.FromEulerAngles(o.rotation[0], o.rotation[1], o.rotation[2]);
    }
    this.recomputeAll(false);
    this.emitSnapshot();
  }

  removeObstacle(id: string): void {
    const node = this.obstacleNodes.get(id);
    if (!node) return;
    if (this.selection.id === id) this.detachGizmo();
    node.root.dispose();
    this.obstacleNodes.delete(id);
    this.data.obstacles = this.data.obstacles.filter((o) => o.id !== id);
    this.recomputeAll(false);
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  // ---------- 弹道 ----------
  private buildTrajView(t: Trajectory): void {
    const mat = new StandardMaterial(`trajMat_${t.id}`, this.scene);
    const c = Color3.FromHexString(t.color);
    mat.emissiveColor = c;
    mat.diffuseColor = c.scale(0.3);
    mat.specularColor = new Color3(0, 0, 0);

    const segMat = new StandardMaterial(`segMat_${t.id}`, this.scene);
    segMat.emissiveColor = new Color3(1, 0.25, 0.15);
    segMat.diffuseColor = new Color3(0.5, 0.05, 0.02);
    segMat.specularColor = new Color3(0, 0, 0);

    const mkMarkerMat = (hex: string) => {
      const m = new StandardMaterial(`markerMat_${hex}_${t.id}`, this.scene);
      const cc = Color3.FromHexString(hex);
      m.emissiveColor = cc;
      m.diffuseColor = cc.scale(0.3);
      return m;
    };
    this.trajViews.set(t.id, {
      data: t,
      tube: null,
      material: mat,
      segPool: [],
      segPoolMat: segMat,
      markerPool: [],
      markerMatIn: mkMarkerMat('#ff3b30'),
      markerMatOut: mkMarkerMat('#ffcc33'),
    });
  }

  createTrajectory(): Trajectory | null {
    const entry = this.data.points.find((p) => p.type === 'entry');
    const exit = this.data.points.find((p) => p.type === 'exit');
    if (!entry || !exit) return null;
    const seq = this.data.trajectories.length + 1;
    const pointIds = [
      entry.id,
      ...this.data.points.filter((p) => p.type === 'constraint').map((p) => p.id),
      exit.id,
    ];
    const palette = ['#36c5f0', '#a98bff', '#54d68a', '#ff9f43', '#ff6b9d'];
    const t: Trajectory = {
      id: uid('tj'),
      name: `候选弹道 ${seq}`,
      pointIds,
      bendLevel: 3,
      snap: true,
      samples: [],
      occlusions: [],
      visible: true,
      color: palette[(seq - 1) % palette.length],
    };
    this.data.trajectories.push(t);
    this.data.activeTrajectoryId = t.id;
    this.buildTrajView(t);
    this.recomputeAll(true);
    this.applySelectionVisual();
    this.emitSnapshot();
    return t;
  }

  selectTrajectory(id: string | null): void {
    this.data.activeTrajectoryId = id;
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  setTrajectoryVisible(id: string, visible: boolean): void {
    const t = this.data.trajectories.find((x) => x.id === id);
    if (!t) return;
    t.visible = visible;
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  removeTrajectory(id: string): void {
    const view = this.trajViews.get(id);
    if (view) {
      this.disposeTrajView(view);
      this.trajViews.delete(id);
    }
    this.data.trajectories = this.data.trajectories.filter((t) => t.id !== id);
    if (this.data.activeTrajectoryId === id) {
      this.data.activeTrajectoryId = this.data.trajectories[0]?.id ?? null;
    }
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  setBendLevel(id: string, level: number): void {
    const t = this.data.trajectories.find((x) => x.id === id);
    if (!t) return;
    t.bendLevel = Math.min(5, Math.max(1, level));
    this.recomputeAll(true);
    this.emitSnapshot();
  }

  setSnap(id: string, snap: boolean): void {
    const t = this.data.trajectories.find((x) => x.id === id);
    if (!t) return;
    t.snap = snap;
    this.recomputeAll(true);
    this.emitSnapshot();
  }

  private disposeTrajView(v: TrajView): void {
    v.tube?.dispose();
    v.segPool.forEach((m) => m.dispose());
    v.markerPool.forEach((m) => m.dispose());
    v.material.dispose();
    v.segPoolMat.dispose();
    v.markerMatIn.dispose();
    v.markerMatOut.dispose();
  }

  /** 性能基准：纯重算路径（与拖拽 frameTick 同路径，不含 React 快照开销） */
  benchmarkRecompute(iterations: number): number {
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) this.recomputeAll(false);
    return (performance.now() - t0) / iterations;
  }

  /** 分项基准：网格建格 / 遮挡求交 / 管体几何重建 各自耗时 */
  benchmarkBreakdown(): { gridMs: number; occlusionMs: number; geometryMs: number; occlusionCount: number } {
    const N = 30;
    let gridMs = 0;
    let occlusionMs = 0;
    let geometryMs = 0;
    let count = 0;
    const obbOf = (o: Obstacle): OBB => this.obbOf(o);
    for (let i = 0; i < N; i++) {
      this.obbCache.clear();
      let t = performance.now();
      this.grid.build(this.data.obstacles, obbOf);
      gridMs += performance.now() - t;

      t = performance.now();
      for (const tr of this.data.trajectories) {
        tr.occlusions = computeOcclusions(tr.samples, this.data.obstacles, obbOf, this.grid);
        count = tr.occlusions.length;
      }
      occlusionMs += performance.now() - t;

      t = performance.now();
      for (const tr of this.data.trajectories) this.refreshTrajGeometry(tr);
      geometryMs += performance.now() - t;
    }
    this.recomputeAll(false);
    return {
      gridMs: gridMs / N,
      occlusionMs: occlusionMs / N,
      geometryMs: geometryMs / N,
      occlusionCount: count,
    };
  }

  // ---------- 拟合与遮挡重算 ----------
  /** OBB 缓存：每帧每个障碍物只构造一次旋转矩阵，网格与线段测试共享 */
  private obbCache = new Map<string, OBB>();

  private obbOf(o: Obstacle): OBB {
    const cached = this.obbCache.get(o.id);
    if (cached) return cached;
    const q = Quaternion.FromEulerAngles(o.rotation[0], o.rotation[1], o.rotation[2]);
    const m = TmpVectors.Matrix[0];
    q.toRotationMatrix(m);
    const obb: OBB = {
      center: o.position,
      axes: [
        [m.m[0], m.m[1], m.m[2]],
        [m.m[4], m.m[5], m.m[6]],
        [m.m[8], m.m[9], m.m[10]],
      ],
      halfExtents: o.halfExtents,
    };
    this.obbCache.set(o.id, obb);
    return obb;
  }

  /**
   * 重算管线：先按当前点位/档位/吸附重新拟合曲线，再重建哈希网格做遮挡判定，
   * 最后刷新弹道管、遮挡段高亮与障碍物染色。拖拽时每帧调用。
   */
  private recomputeAll(refit: boolean): void {
    const started = performance.now();
    if (refit) {
      for (const t of this.data.trajectories) {
        const knots = t.pointIds
          .map((id) => this.data.points.find((p) => p.id === id))
          .filter((p): p is BallisticPoint => Boolean(p))
          .map((p) => ({ p: p.position, dir: p.direction }));
        t.samples = knots.length >= 2 ? fitTrajectory(knots, t.bendLevel, t.snap).samples : [];
      }
    }
    // 单帧内 OBB 只算一次：网格建格与全部线段求交共享同一份缓存
    this.obbCache.clear();
    const obbOf = (o: Obstacle): OBB => this.obbOf(o);
    this.grid.build(this.data.obstacles, obbOf);
    const occluding = new Set<string>();
    for (const t of this.data.trajectories) {
      t.occlusions =
        t.samples.length >= 2
          ? computeOcclusions(t.samples, this.data.obstacles, obbOf, this.grid)
          : [];
      for (const seg of t.occlusions) occluding.add(seg.obstacleId);
      this.refreshTrajGeometry(t);
    }
    for (const [id, node] of this.obstacleNodes) {
      if (!node.material) continue;
      if (occluding.has(id)) {
        node.material.emissiveColor = new Color3(0.55, 0.08, 0.05);
      } else {
        node.material.emissiveColor = node.baseEmissive;
      }
    }
    this.lastOcclusionMs = performance.now() - started;
  }

  private refreshTrajGeometry(t: Trajectory): void {
    const view = this.trajViews.get(t.id);
    if (!view) return;
    const active = this.data.activeTrajectoryId === t.id;
    const hasCurve = t.samples.length >= 2;
    view.tube?.setEnabled(t.visible && hasCurve);

    // 非激活弹道只做淡出，不重建几何——多候选对比时把开销集中在当前选中的一条
    if (!active) {
      view.material.alpha = t.visible ? 0.18 : 0;
      for (const m of view.segPool) m.setEnabled(false);
      for (const m of view.markerPool) m.setEnabled(false);
      return;
    }

    if (hasCurve) {
      const path = t.samples.map((s) => toV3(s));
      const radius = 0.06;
      if (!view.tube) {
        view.tube = MeshBuilder.CreateTube(`tube_${t.id}`, {
          path,
          radius,
          tessellation: TUBE_TESSELLATION,
          updatable: true,
        }, this.scene);
        view.tube.material = view.material;
        view.tube.metadata = { kind: 'trajectory', id: t.id };
        view.tube.isPickable = true;
      } else {
        // 官方 dynamicMeshMorph：path 点数固定为 201，instance 更新安全
        MeshBuilder.CreateTube(`tube_${t.id}`, {
          path,
          radius,
          tessellation: TUBE_TESSELLATION,
          updatable: true,
          instance: view.tube,
        }, this.scene);
      }
      view.material.alpha = t.visible ? 1 : 0;
    }

    // 遮挡段红管（对象池）。关键：Path3D.update 要求新旧 path 点数相同，
    // 每段固定 SEG_PATH_POINTS 点重采样，遮挡区间之外收缩为零长度
    const needed = active && t.visible ? t.occlusions.length : 0;
    for (let i = 0; i < needed; i++) {
      const seg = t.occlusions[i];
      const segPath = resampleRange(t.samples, seg.tStart, seg.tEnd, SEG_PATH_POINTS).map((s) => toV3(s));
      let mesh = view.segPool[i];
      if (!mesh) {
        mesh = MeshBuilder.CreateTube(`seg_${t.id}_${i}`, {
          path: segPath,
          radius: 0.085,
          tessellation: SEG_TESSELLATION,
          updatable: true,
        }, this.scene);
        mesh.material = view.segPoolMat;
        mesh.isPickable = false;
        view.segPool[i] = mesh;
      } else {
        mesh.setEnabled(true);
        MeshBuilder.CreateTube(`seg_${t.id}_${i}`, {
          path: segPath,
          radius: 0.085,
          tessellation: SEG_TESSELLATION,
          updatable: true,
          instance: mesh,
        }, this.scene);
      }
    }
    for (let i = needed; i < view.segPool.length; i++) view.segPool[i].setEnabled(false);

    // 遮挡位置标记球：每段入射点（红）/ 穿出点（黄）
    const markerNeeded = needed * 2;
    for (let i = 0; i < markerNeeded; i++) {
      const seg = t.occlusions[Math.floor(i / 2)];
      const pos = i % 2 === 0 ? seg.enterPosition : seg.exitPosition;
      let marker = view.markerPool[i];
      if (!marker) {
        marker = MeshBuilder.CreateSphere(`marker_${t.id}_${i}`, { diameter: 0.22, segments: 10 }, this.scene);
        marker.material = i % 2 === 0 ? view.markerMatIn : view.markerMatOut;
        marker.isPickable = false;
        view.markerPool[i] = marker;
      }
      marker.setEnabled(true);
      marker.position = toV3(pos);
    }
    for (let i = markerNeeded; i < view.markerPool.length; i++) view.markerPool[i].setEnabled(false);
  }

  // ---------- 选择与 Gizmo ----------
  setToolMode(mode: ToolMode): void {
    this.toolMode = mode;
    if (mode !== 'select') this.detachGizmo();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.attachGizmo(this.selection);
  }

  /** 供 UI 列表选中场景对象 */
  selectObject(sel: Selection): void {
    this.select(sel);
  }

  private select(sel: Selection): void {
    this.selection = sel;
    this.attachGizmo(sel);
    this.applySelectionVisual();
    this.emitSnapshot();
  }

  private detachGizmo(): void {
    this.posGizmo.attachedNode = null;
    this.rotGizmo.attachedNode = null;
  }

  private attachGizmo(sel: Selection): void {
    this.detachGizmo();
    if (!sel.id || this.gizmoMode === 'none') return;
    let node: TransformNode | null = null;
    if (sel.kind === 'point') node = this.pointNodes.get(sel.id)?.root ?? null;
    if (sel.kind === 'obstacle') node = this.obstacleNodes.get(sel.id)?.root ?? null;
    if (!node) return;
    if (this.gizmoMode === 'position') this.posGizmo.attachedNode = node;
    else this.rotGizmo.attachedNode = node;
  }

  private applySelectionVisual(): void {
    for (const [id, n] of this.pointNodes) {
      const sel = this.selection.kind === 'point' && this.selection.id === id;
      n.sphere.scaling = new Vector3(sel ? 1.35 : 1, sel ? 1.35 : 1, sel ? 1.35 : 1);
    }
    for (const t of this.data.trajectories) this.refreshTrajGeometry(t);
  }

  private beginDrag(): void {
    this.dragging = true;
  }

  /** 拖拽中每帧同步权威数据并实时重判；不触发 React 渲染，保证流畅 */
  private frameTick(): void {
    if (!this.dragging) return;
    const attached = this.posGizmo.attachedNode ?? this.rotGizmo.attachedNode;
    if (!attached) return;
    const meta = attached.metadata as { kind?: string; id?: string } | undefined;
    // point 根节点没有 metadata，沿子球取
    let kind = meta?.kind;
    let id = meta?.id;
    if (!kind) {
      const pn = [...this.pointNodes.entries()].find(([, n]) => n.root === attached);
      if (pn) {
        kind = 'point';
        id = pn[0];
      }
    }
    if (kind === 'obstacle' && id) {
      const o = this.data.obstacles.find((x) => x.id === id)!;
      const n = this.obstacleNodes.get(id)!;
      o.position = fromV3(n.root.position);
      const e = n.root.rotationQuaternion!.toEulerAngles();
      o.rotation = [e.x, e.y, e.z];
      this.recomputeAll(false);
    } else if (kind === 'point' && id) {
      const p = this.data.points.find((x) => x.id === id)!;
      const n = this.pointNodes.get(id)!;
      p.position = fromV3(n.root.position);
      // 方向箭头建模时与本地 +Y 对齐，旋转后取矩阵第二行即世界方向
      const m = n.root.rotationQuaternion!.toRotationMatrix(TmpVectors.Matrix[0]);
      const row = m.getRow(1);
      if (!row) return;
      p.direction = normalize([row.x, row.y, row.z]);
      this.recomputeAll(true);
    }
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.emitSnapshot();
  }

  private onTap(info: PointerInfo): void {
    if (info.type !== PointerEventTypes.POINTERTAP) return;
    const mesh = info.pickInfo?.pickedMesh as Mesh | null;
    const point = info.pickInfo?.pickedPoint;
    if (this.toolMode !== 'select') {
      const pos: Vec3 | undefined = point ? fromV3(point) : undefined;
      if (this.toolMode === 'add-entry') this.addPoint('entry', pos);
      else if (this.toolMode === 'add-exit') this.addPoint('exit', pos);
      else if (this.toolMode === 'add-constraint') this.addPoint('constraint', pos);
      else if (this.toolMode === 'add-box') {
        // 让长方体底面落在地面上而非半埋
        this.addBox(pos ? [pos[0], 1, pos[2]] : undefined);
      }
      return;
    }
    const meta = mesh?.metadata as { kind?: string; id?: string } | undefined;
    if (meta?.kind === 'point' && meta.id) this.select({ kind: 'point', id: meta.id });
    else if (meta?.kind === 'obstacle' && meta.id) this.select({ kind: 'obstacle', id: meta.id });
    else if (meta?.kind === 'trajectory' && meta.id) {
      this.selectTrajectory(meta.id);
      this.select({ kind: 'trajectory', id: meta.id });
    } else if (meta?.kind === 'ground') {
      this.detachGizmo();
      this.selection = { kind: null, id: null };
      this.applySelectionVisual();
      this.emitSnapshot();
    }
  }

  /** 朝向辅助：让射入点方向对准当前射出点 */
  alignEntryToExit(pointId: string): void {
    const p = this.data.points.find((x) => x.id === pointId);
    if (!p) return;
    const target = this.data.points.find((x) => x.type === (p.type === 'entry' ? 'exit' : 'entry'));
    if (!target) return;
    this.updatePoint(pointId, { direction: normalize(sub(target.position, p.position)) });
  }

  /** 计算方向正交基，供 UI 显示 */
  basisOf(pointId: string): { x: Vec3; y: Vec3; z: Vec3 } | null {
    const p = this.data.points.find((x) => x.id === pointId);
    return p ? basisFromDir(p.direction) : null;
  }

  sampleTrajectoryAt(id: string, t: number): Vec3 | null {
    const tr = this.data.trajectories.find((x) => x.id === id);
    if (!tr || tr.samples.length < 2) return null;
    return sampleAt(tr.samples, t);
  }

  /** 吸附辅助：返回离给定世界位置最近的约束点距离 */
  nearestConstraintDistance(pos: Vec3): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const p of this.data.points) {
      if (p.type !== 'constraint') continue;
      const d = dist(pos, p.position);
      if (!best || d < best.distance) best = { id: p.id, distance: d };
    }
    return best;
  }

  dispose(): void {
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    this.listeners.clear();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

// ---------- 工具函数 ----------
/**
 * 在完整采样折线上取 [tStart,tEnd] 区间，并输出固定 count 个点。
 * 遮挡段管每次更新点数必须恒定（Babylon Path3D.update 的限制），
 * 区间外的输出点全部折叠到端点，形成零长度管段。
 */
function resampleRange(samples: Vec3[], tStart: number, tEnd: number, count: number): Vec3[] {
  const out: Vec3[] = [];
  const maxIndex = samples.length - 1;
  for (let k = 0; k < count; k++) {
    const g = k / (count - 1);
    const t = tStart + g * (tEnd - tStart);
    const f = Math.min(1, Math.max(0, t)) * maxIndex;
    const i = Math.min(maxIndex - 1, Math.floor(f));
    const a = samples[i];
    const b = samples[i + 1];
    const u = f - i;
    out.push([
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
    ]);
  }
  return out;
}

function toV3(a: Vec3): Vector3 {
  return new Vector3(a[0], a[1], a[2]);
}

/** data URL（base64）解码为字节数组，供 SceneLoader 以 rawData 方式加载二进制 glTF */
function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function fromV3(v3: Vector3): Vec3 {
  return [v3.x, v3.y, v3.z];
}

export function emptyProject(): ProjectData {
  return {
    version: 1,
    name: '未命名现场',
    points: [],
    obstacles: [],
    trajectories: [],
    activeTrajectoryId: null,
    assets: [],
    updatedAt: Date.now(),
  };
}
