// 场景管理器：three.js 渲染、骨骼对象池、拾取交互、吸附/裁切/贴地
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoneInstance, ProjectData, ResolvedTemplate, Vec3Tuple } from '../types';
import { templateByKey } from '../lib/catalog';
import {
  collectOccupied,
  computeFK,
  findAnchorIds,
  findNearestSlot,
  type ComputedBone,
} from '../lib/kinematics';
import { clampRotation, deepClone } from '../lib/math3d';
import { bboxLowestWorld, getSharedGeometry } from './geometryFactory';
import { TransformGizmo } from './TransformGizmo';
import { ClipPlaneWidget } from './ClipPlaneWidget';
import { terrainHeight, buildTerrainMesh } from '../lib/terrain';
import { skeletonStore } from '../store/skeletonStore';
import { mirrorSubtree } from '../lib/mirror';

interface BoneObject {
  instance: BoneInstance;
  template: ResolvedTemplate;
  group: THREE.Group;   // 关节节点（矩阵 = FK 世界矩阵）
  mesh: THREE.Mesh;     // 共享几何的实例
  baseColor: THREE.Color;
}

const BONE_COLORS: Record<string, number> = {
  skull: 0xe8ddc0,
  spine: 0xf2e6c8,
  ribs: 0xd9cfae,
  girdle: 0xe3d5b3,
  forelimb: 0xd6c69e,
  hindlimb: 0xcdbd93,
  other: 0xc9bd9c,
};
const LIMIT_COLOR = new THREE.Color(0xff3b30);
const SELECT_EMISSIVE = new THREE.Color(0x2a4a6b);

const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private boneRoot = new THREE.Group();
  private gizmo = new TransformGizmo();
  private clipWidget = new ClipPlaneWidget(7);
  private terrain: THREE.Mesh;

  private objects = new Map<string, BoneObject>();
  private fk = computeFK(skeletonStore.getProject());
  private cachedProject: ProjectData | null = null;
  private raf = 0;
  private container: HTMLElement;
  private clipMat = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  private lastHits = new Map<string, Array<'x' | 'y' | 'z'>>();

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1d2126);
    this.scene.fog = new THREE.Fog(0x1d2126, 22, 48);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 200);
    this.camera.position.set(7, 5.5, 9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 2.2, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495;

    const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x4a4034, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff2d8, 1.6);
    dir.position.set(8, 14, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -12;
    dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12;
    dir.shadow.camera.bottom = -12;
    dir.shadow.camera.far = 40;
    this.scene.add(dir);

    const grid = new THREE.GridHelper(80, 80, 0x3d4750, 0x2b333a);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = -3.2;
    this.scene.add(grid);

    this.terrain = buildTerrainMesh();
    this.scene.add(this.terrain);

    this.scene.add(this.boneRoot);
    this.scene.add(this.gizmo.group);
    this.scene.add(this.clipWidget.group);

    this.bindEvents();
    this.syncFromStore();
    this.loop();
  }

  // ---------- 生命周期 ----------

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- 状态 → 场景同步 ----------

  syncFromStore() {
    const project = skeletonStore.getProject();
    // React 重渲染也会触发本方法；项目引用未变时跳过重算，保证拖动期间每帧只算一次 FK
    if (project === this.cachedProject) {
      this.updateGizmoPlacement(project);
      return;
    }
    this.cachedProject = project;
    this.fk = computeFK(project);
    const keep = new Set<string>();

    for (const cb of this.fk.map.values()) {
      keep.add(cb.bone.id);
      let obj = this.objects.get(cb.bone.id);
      if (!obj) obj = this.createBoneObject(cb);
      obj.instance = cb.bone;
      obj.group.matrixAutoUpdate = false;
      obj.group.matrix.copy(cb.worldMatrix);
      this.applyAppearance(obj);
    }
    for (const [id, obj] of this.objects) {
      if (!keep.has(id)) {
        this.boneRoot.remove(obj.group);
        this.objects.delete(id);
      }
    }

    this.updateGizmoPlacement(project);
    this.updateClip(project);
  }

  private createBoneObject(cb: ComputedBone): BoneObject {
    const shared = getSharedGeometry(cb.template);
    const baseColor = new THREE.Color(BONE_COLORS[cb.template.group] ?? 0xd9cfae);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.62,
      metalness: 0.05,
      clippingPlanes: [this.clipMat],
      clipShadows: true,
      emissive: 0x000000,
    });
    const mesh = new THREE.Mesh(shared.geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.boneId = cb.bone.id;

    const group = new THREE.Group();
    group.add(mesh);
    this.boneRoot.add(group);

    const obj: BoneObject = {
      instance: cb.bone,
      template: cb.template,
      group,
      mesh,
      baseColor,
    };
    this.objects.set(cb.bone.id, obj);
    return obj;
  }

  private applyAppearance(obj: BoneObject) {
    const mat = obj.mesh.material as THREE.MeshStandardMaterial;
    const selected = skeletonStore.getSnapshot().selectedId === obj.instance.id;
    const hits = this.lastHits.get(obj.instance.id);
    if (hits && hits.length > 0) {
      mat.color.copy(LIMIT_COLOR);
      mat.emissive.setRGB(0.35, 0.02, 0.01);
    } else {
      mat.color.copy(obj.baseColor);
      mat.emissive.copy(selected ? SELECT_EMISSIVE : new THREE.Color(0, 0, 0));
    }
  }

  /** 场景层接收最新极限命中（由旋转交互回写 store 后调用） */
  setLimitHits(hits: Map<string, Array<'x' | 'y' | 'z'>>) {
    this.lastHits = hits;
    for (const obj of this.objects.values()) this.applyAppearance(obj);
  }

  private updateGizmoPlacement(project: ProjectData) {
    const snap = skeletonStore.getSnapshot();
    this.gizmo.setMode(snap.transformMode);
    const selId = snap.selectedId;
    if (!selId) {
      this.gizmo.setVisible(false);
      return;
    }
    if (snap.transformMode === 'root') {
      tmpEuler.set(...project.rootTransform.rot, 'XYZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpVec.fromArray(project.rootTransform.pos);
      tmpMatrix.compose(tmpVec, tmpQuat, tmpScale);
      this.gizmo.place(tmpMatrix);
      this.gizmo.setVisible(true);
      return;
    }
    const cb = this.fk.map.get(selId);
    if (!cb) {
      this.gizmo.setVisible(false);
      return;
    }
    this.gizmo.place(cb.worldMatrix);
    this.gizmo.setVisible(true);
  }

  private updateClip(project: ProjectData) {
    const clip = project.settings.clip;
    this.clipWidget.update(
      new THREE.Vector3(...clip.pos),
      new THREE.Vector3(...clip.normal).normalize(),
    );
    this.clipWidget.setVisible(clip.enabled);
    const plane = this.clipWidget.getClipPlane();
    this.clipMat.copy(plane);
    // 动态切换裁切数组：关闭时清空，避免用极大 constant 这种不可靠手法
    const planes = clip.enabled ? [this.clipMat] : [];
    for (const obj of this.objects.values()) {
      const mat = obj.mesh.material as THREE.MeshStandardMaterial;
      const current = mat.clippingPlanes ?? [];
      if (clip.enabled && current.length === 0) mat.clippingPlanes = planes;
      if (!clip.enabled && current.length > 0) mat.clippingPlanes = [];
      mat.needsUpdate = true;
    }
  }

  // ---------- 拾取 ----------

  private ndcFromEvent(e: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private pickBone(ndc: THREE.Vector2): BoneObject | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const o of this.objects.values()) meshes.push(o.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.boneId as string;
    return this.objects.get(id) ?? null;
  }

  // ---------- 指针交互 ----------

  private downInfo: { x: number; y: number; moved: boolean } | null = null;

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const ndc = this.ndcFromEvent(e);
    this.downInfo = { x: e.clientX, y: e.clientY, moved: false };

    // 1) 剖面平面拖动优先
    const snap = skeletonStore.getSnapshot();
    if (snap.project.settings.clip.enabled && this.clipWidget.hitTest(this.camera, ndc)) {
      this.clipWidget.startDrag(this.camera, ndc);
      this.controls.enabled = false;
      skeletonStore.beginInteraction();
      return;
    }

    // 2) 变换手柄
    const axis = this.gizmo.hitTest(this.camera, ndc);
    if (axis && snap.selectedId) {
      if (snap.transformMode === 'root') {
        const p = new THREE.Vector3(...snap.project.rootTransform.pos);
        if (this.gizmo.startTranslate(this.camera, ndc, p)) {
          this.controls.enabled = false;
          skeletonStore.beginInteraction();
        }
      } else {
        const cb = this.fk.map.get(snap.selectedId);
        if (cb) {
          const ok = this.gizmo.startRotate(
            axis,
            this.camera,
            ndc,
            cb.worldPos.clone(),
            cb.worldQuat.clone(),
            tmpEuler.set(...cb.bone.rotation, 'XYZ').clone(),
          );
          if (ok) {
            this.controls.enabled = false;
            skeletonStore.beginInteraction();
          }
        }
      }
      return;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const ndc = this.ndcFromEvent(e);
    if (this.downInfo) {
      const dx = e.clientX - this.downInfo.x;
      const dy = e.clientY - this.downInfo.y;
      if (dx * dx + dy * dy > 16) this.downInfo.moved = true;
    }

    // 剖面拖动
    if (this.clipWidget.isDragging()) {
      const pos = this.clipWidget.updateDrag(this.camera, ndc);
      if (pos) {
        const cur = skeletonStore.getProject().settings.clip;
        skeletonStore.applyLiveClip({
          enabled: true,
          pos: [pos.x, pos.y, pos.z],
          normal: [...cur.normal] as Vec3Tuple,
        });
      }
      return;
    }

    // 根节点平移
    if (this.gizmo.isTranslating()) {
      const r = this.gizmo.updateTranslate(this.camera, ndc);
      if (r) {
        const cur = skeletonStore.getProject().rootTransform;
        skeletonStore.applyLiveRoot({
          pos: [r.pos.x, r.pos.y, r.pos.z],
          rot: [...cur.rot] as Vec3Tuple,
        });
      }
      return;
    }

    // 关节旋转
    if (this.gizmo.isRotating()) {
      const result = this.gizmo.updateRotate(this.camera, ndc);
      if (result) this.handleRotateFrame(result.rotation);
      return;
    }

    // hover 高亮手柄轴
    const axis = this.gizmo.hitTest(this.camera, ndc);
    this.gizmo.setHover(axis);
    this.renderer.domElement.style.cursor = axis ? 'pointer' : 'default';
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;

    if (this.clipWidget.isDragging()) {
      this.clipWidget.endDrag();
      this.controls.enabled = true;
      skeletonStore.endInteraction('拖动裁切平面');
      this.downInfo = null;
      return;
    }
    if (this.gizmo.isTranslating()) {
      this.gizmo.endTranslate();
      this.controls.enabled = true;
      skeletonStore.endInteraction('整体平移');
      this.downInfo = null;
      return;
    }
    if (this.gizmo.isRotating()) {
      this.gizmo.endRotate();
      this.controls.enabled = true;
      skeletonStore.endInteraction('旋转关节');
      this.setLimitHits(new Map());
      skeletonStore.setLimitHits(new Map());
      this.downInfo = null;
      return;
    }

    // 普通点击：选择 / 取消选择
    if (this.downInfo && !this.downInfo.moved) {
      const ndc = this.ndcFromEvent(e);
      const hit = this.pickBone(ndc);
      skeletonStore.select(hit ? hit.instance.id : null);
    }
    this.downInfo = null;
  };

  /** 一帧旋转：钳制 → 命中高亮 → 回写 store（含镜像联动） */
  private handleRotateFrame(euler: THREE.Euler) {
    const snap = skeletonStore.getSnapshot();
    const selId = snap.selectedId;
    if (!selId) return;
    const cb = this.fk.map.get(selId);
    if (!cb) return;

    const raw: Vec3Tuple = [euler.x, euler.y, euler.z];
    const { value, hit } = clampRotation(raw, cb.template.limits);
    const hits = new Map<string, Array<'x' | 'y' | 'z'>>();
    const axes = ['x', 'y', 'z'] as const;
    const hitAxes = axes.filter((a) => hit[a]);
    if (hitAxes.length) hits.set(selId, hitAxes);
    this.setLimitHits(hits);
    skeletonStore.setLimitHits(hits);

    skeletonStore.applyLiveRotation(selId, value);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  private unbindEvents() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ---------- 拖入（HTML5 DnD） ----------

  /** 计算落点的世界坐标（与地形求交，无交点则取 y=0 平面） */
  dropWorldPoint(clientX: number, clientY: number): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const groundHit = this.raycaster.intersectObject(this.terrain, false);
    if (groundHit.length) return groundHit[0].point.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ?? new THREE.Vector3();
  }

  /**
   * 拖入一块骨骼：自动吸附到最近的兼容空闲插槽。
   * 返回创建结果（是否吸附、距离）。
   */
  handleDrop(templateKey: string, clientX: number, clientY: number) {
    const template = templateByKey(templateKey);
    const project = skeletonStore.getProject();
    const point = this.dropWorldPoint(clientX, clientY);

    // 空场景：第一块骨骼直接落在根层级
    if (project.bones.length === 0) {
      const created = skeletonStore.addBone({
        templateBaseId: template.baseId,
        side: template.side,
        parentId: null,
        parentSlotId: null,
      });
      return { snapped: false, created: created.id };
    }

    const fk = computeFK(project);
    const occupied = collectOccupied(project.bones);
    const nearest = findNearestSlot(fk, template, point, occupied);
    const SNAP_RADIUS = 3.0;
    if (nearest && nearest.distance <= SNAP_RADIUS) {
      const created = skeletonStore.addBone({
        templateBaseId: template.baseId,
        side: template.side,
        parentId: nearest.parentId,
        parentSlotId: nearest.slotId,
        label: '拖入吸附',
      });
      return { snapped: true, created: created.id, distance: nearest.distance };
    }
    // 超出吸附半径：成为自由根级骨骼，仍可后续手动挂载
    const created = skeletonStore.addBone({
      templateBaseId: template.baseId,
      side: template.side,
      parentId: null,
      parentSlotId: null,
      label: '拖入骨骼',
    });
    return { snapped: false, created: created.id };
  }

  // ---------- 镜像（场景层提供入口，复用 store 历史） ----------

  mirrorSelected(): boolean {
    const selId = skeletonStore.getSnapshot().selectedId;
    if (!selId) return false;
    const project = skeletonStore.getProject();
    const result = mirrorSubtree(project, selId);
    if (!result.bones.length) return false;
    skeletonStore.addMirroredBones(result.bones, result.newRootId);
    return true;
  }

  // ---------- 地面吸附 ----------

  /** 计算贴地后的项目副本（最低点取子树包围盒角点） */
  computeGroundSnapped(): ProjectData {
    const project = skeletonStore.getProject();
    const anchors = findAnchorIds(project.bones);
    const fk = computeFK(project);
    const snapped = deepClone(project);

    const lowestOf = (boneId: string): { x: number; y: number; z: number } | null => {
      const found: THREE.Vector3[] = [];
      const collect = (id: string) => {
        const cb = fk.map.get(id);
        const obj = this.objects.get(id);
        if (cb && obj) {
          found.push(bboxLowestWorld(getSharedGeometry(cb.template).bbox, cb.worldMatrix));
        }
        for (const child of cb?.children ?? []) collect(child);
      };
      collect(boneId);
      if (!found.length) return null;
      found.sort((a, b) => a.y - b.y);
      const lowest = found[0];
      return { x: lowest.x, y: lowest.y, z: lowest.z };
    };

    const index = new Map(snapped.bones.map((b, i) => [b.id, i]));
    for (const anchorId of anchors) {
      const cb = fk.map.get(anchorId);
      const low = lowestOf(anchorId);
      if (!cb || !low) continue;
      const dy = terrainHeight(low.x, low.z) - low.y;
      if (Math.abs(dy) < 1e-4) continue;
      const parent = cb.bone.parentId ? fk.map.get(cb.bone.parentId) : null;
      const slotM = parent?.slotWorld.get(cb.bone.parentSlotId ?? '');
      const delta = new THREE.Vector3(0, dy, 0);
      if (slotM) {
        const sq = new THREE.Quaternion();
        slotM.decompose(tmpVec, sq, tmpScale);
        delta.applyQuaternion(sq.invert());
      }
      const idx = index.get(anchorId)!;
      const lp = snapped.bones[idx].localPos;
      snapped.bones[idx].localPos = [lp[0] + delta.x, lp[1] + delta.y, lp[2] + delta.z];
    }
    return snapped;
  }
}
