import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createEyeSurfaceGeometry,
  eyeTarget,
  makeEyelidCurve,
  nearestEyelidT,
  otherSide,
  surfaceNormal,
  surfaceZ,
} from './faceGeometry';
import { LashBatch, getLashCenters } from './lashBatch';
import {
  buildBrowHairs,
  buildBrowRibbonGeometry,
  updateBrowHairs,
} from './browView';
import {
  breakPointMirror,
  eraseBrow,
  makeLash,
  replaceBrowFromStroke,
  syncBrowMirror,
} from './model';
import type {
  EditorMode,
  ProjectDocument,
  SelectionPatch,
  SelectionState,
  Side,
  Tool,
} from './types';

export interface SceneBridge {
  getDoc(): ProjectDocument;
  beginHistory(): void;
  endHistory(): void;
  transact(fn: (draft: ProjectDocument) => void): void;
  commit(fn: (draft: ProjectDocument) => void): void;
  onSelection(patch: SelectionPatch): void;
}

interface BrowViewRecord {
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  pick: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  hairs: THREE.InstancedMesh | null;
}

type DragState =
  | { type: 'browPoint'; side: Side; pointId: string; pointerId: number }
  | {
      type: 'browWidth';
      side: Side;
      pointId: string;
      pointerId: number;
      startY: number;
      startWidth: number;
    }
  | { type: 'lash'; id: string; pointerId: number }
  | { type: 'newLash'; id: string; pointerId: number }
  | { type: 'drawBrow'; side: Side; pointerId: number }
  | { type: 'erase'; pointerId: number };

const DEFAULT_CAMERA = new THREE.Vector3(0, 0.22, 4.45);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.16, 0);

export class SceneManager {
  private container: HTMLElement;
  private bridge: SceneBridge;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private faceMesh!: THREE.Mesh;
  private browGroup = new THREE.Group();
  private browPickGroup = new THREE.Group();
  private handleGroup = new THREE.Group();
  private eyelidHitGroup = new THREE.Group();
  private eyelidLines: THREE.Mesh[] = [];
  private lashBatch = new LashBatch();
  private selectionGroup = new THREE.Group();
  private selectedLashLine!: THREE.Line;
  private selectedAnchor!: THREE.Mesh;
  private selectedTip!: THREE.Mesh;
  private rawLine!: THREE.Line;
  private rawPoints: Array<{ x: number; y: number }> = [];

  private browViews = new Map<Side, BrowViewRecord>();
  private widthHandle: THREE.Mesh | null = null;
  private widthLine: THREE.Line | null = null;

  private mode: EditorMode = 'brow';
  private tool: Tool = 'draw';
  private unilateralFineTune = false;
  selection: SelectionState = {
    side: 'right',
    browPointId: null,
    lashId: null,
    rowId: null,
  };

  private drag: DragState | null = null;
  private animationFrame = 0;
  private cameraTween: {
    start: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  constructor(container: HTMLElement, bridge: SceneBridge) {
    this.container = container;
    this.bridge = bridge;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'three-canvas';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 100);
    this.camera.position.copy(DEFAULT_CAMERA);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(DEFAULT_TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.72;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.74;
    this.controls.update();

    this.scene.background = new THREE.Color('#f4e9df');
    this.buildLights();
    this.buildFace();
    this.buildEyes();
    this.buildSelectionHelper();
    this.buildRawLine();

    this.scene.add(this.browGroup, this.browPickGroup, this.handleGroup);
    this.scene.add(this.eyelidHitGroup, this.lashBatch.mesh, this.selectionGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerCancel);
    dom.addEventListener('pointerleave', this.onPointerLeave);

    this.refresh('all');
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerCancel);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.lashBatch.dispose();
    this.renderer.dispose();
    dom.remove();
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
    this.handleGroup.visible = mode === 'brow';
    for (const line of this.eyelidLines) {
      const material = line.material as THREE.MeshStandardMaterial;
      material.emissive?.set(mode === 'lash' ? '#5a2418' : '#000000');
      material.emissiveIntensity = mode === 'lash' ? 0.35 : 0;
    }
    this.updateCursor();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.updateCursor();
  }

  setUnilateralFineTune(value: boolean): void {
    this.unilateralFineTune = value;
  }

  setSelection(selection: SelectionState): void {
    this.selection = { ...selection };
    this.rebuildHandles();
    this.updateSelectionHelper();
  }

  refresh(kind: 'all' | 'brows' | 'lashes' | 'selection' = 'all'): void {
    if (kind === 'all' || kind === 'brows') {
      this.rebuildBrows();
      this.rebuildHandles();
    }
    if (kind === 'all' || kind === 'lashes') {
      const doc = this.bridge.getDoc();
      this.lashBatch.rebuild(doc.lashes, doc.rows);
      this.updateSelectionHelper();
    }
    if (kind === 'all' || kind === 'selection') {
      this.rebuildHandles();
      this.updateSelectionHelper();
    }
  }

  refreshBrowLive(side: Side): void {
    this.updateBrowLive(side);
    this.updateBrowLive(otherSide(side));
  }

  refreshLash(id?: string): void {
    const targetId = id ?? this.selection.lashId;
    if (!targetId) return;
    const doc = this.bridge.getDoc();
    const lash = doc.lashes.find((item) => item.id === targetId);
    if (lash) this.lashBatch.updateLash(lash, doc.rows);
    this.updateSelectionHelper();
  }

  resetCamera(): void {
    this.startCameraTween(DEFAULT_CAMERA, DEFAULT_TARGET, 520);
  }

  setEyeZoom(zoomed: boolean, side: Side = this.selection.side): void {
    if (!zoomed) {
      this.startCameraTween(DEFAULT_CAMERA, DEFAULT_TARGET, 520);
      return;
    }
    const target = eyeTarget(side);
    const s = side === 'right' ? 1 : -1;
    const position = target.clone().add(new THREE.Vector3(s * 0.035, 0.11, 1.12));
    this.startCameraTween(position, target, 520);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#fff4e8', '#7a5544', 1.65));
    const key = new THREE.DirectionalLight('#fff0dd', 2.35);
    key.position.set(-3.2, 4.5, 5.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#c9ddff', 0.72);
    fill.position.set(4, 1.6, 3.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#ffffff', 0.55);
    rim.position.set(0, 3, -4);
    this.scene.add(rim);
  }

  private buildFace(): void {
    const geometry = new THREE.SphereGeometry(1, 96, 64);
    const material = new THREE.MeshStandardMaterial({
      color: '#e7b493',
      roughness: 0.76,
      metalness: 0,
    });
    this.faceMesh = new THREE.Mesh(geometry, material);
    this.faceMesh.scale.set(1.24, 1.62, 0.8);
    this.faceMesh.position.y = 0.04;
    this.faceMesh.userData.kind = 'face';
    this.scene.add(this.faceMesh);

    const skinDark = new THREE.MeshStandardMaterial({ color: '#d99b7d', roughness: 0.82 });

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.145, 0.46, 36), skinDark);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.13, 0.82);
    nose.scale.set(0.82, 1, 1.05);
    this.scene.add(nose);

    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 18), material);
    noseTip.scale.set(1, 0.72, 0.82);
    noseTip.position.set(0, -0.22, 0.82);
    this.scene.add(noseTip);

    const lipMaterial = new THREE.MeshStandardMaterial({
      color: '#b96861',
      roughness: 0.62,
    });
    const lips = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), lipMaterial);
    lips.scale.set(0.31, 0.075, 0.055);
    lips.position.set(0, -0.52, surfaceZ(0, -0.52) + 0.035);
    this.scene.add(lips);

    const earGeometry = new THREE.SphereGeometry(1, 24, 16);
    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(earGeometry, material);
      ear.scale.set(0.12, 0.23, 0.08);
      ear.position.set(s * 1.2, 0.03, -0.02);
      this.scene.add(ear);
    });
  }

  private buildEyes(): void {
    (['left', 'right'] as Side[]).forEach((side) => {
      const eyeGeometry = createEyeSurfaceGeometry(side);
      const eyeMaterial = new THREE.MeshStandardMaterial({
        color: '#f8f1e9',
        roughness: 0.28,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      this.scene.add(eye);

      const s = side === 'right' ? 1 : -1;
      const irisMaterial = new THREE.MeshStandardMaterial({ color: '#4b2d1b', roughness: 0.35 });
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.108, 40), irisMaterial);
      iris.position.set(s * 0.465, 0.282, surfaceZ(s * 0.465, 0.282) + 0.035);
      this.scene.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.CircleGeometry(0.052, 32),
        new THREE.MeshBasicMaterial({ color: '#090604' }),
      );
      pupil.position.copy(iris.position);
      pupil.position.z += 0.006;
      this.scene.add(pupil);

      const highlight = new THREE.Mesh(
        new THREE.CircleGeometry(0.018, 18),
        new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      );
      highlight.position.set(s * 0.44, 0.315, iris.position.z + 0.012);
      this.scene.add(highlight);

      const curve = makeEyelidCurve(side);
      const lineGeometry = new THREE.TubeGeometry(curve, 48, 0.014, 8, false);
      const lineMaterial = new THREE.MeshStandardMaterial({
        color: '#24130d',
        roughness: 0.8,
        emissive: '#000000',
      });
      const lidLine = new THREE.Mesh(lineGeometry, lineMaterial);
      lidLine.userData.kind = 'eyelidVisual';
      this.eyelidLines.push(lidLine);
      this.scene.add(lidLine);

      const hitGeometry = new THREE.TubeGeometry(curve, 32, 0.075, 8, false);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.userData = { kind: 'eyelid', side };
      this.eyelidHitGroup.add(hit);
    });
  }

  private buildSelectionHelper(): void {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: '#ffd166',
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.selectedLashLine = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
    this.selectedLashLine.renderOrder = 1000;
    this.selectedLashLine.frustumCulled = false;
    this.selectionGroup.add(this.selectedLashLine);

    this.selectedAnchor = new THREE.Mesh(
      new THREE.RingGeometry(0.026, 0.041, 28),
      new THREE.MeshBasicMaterial({
        color: '#4cc9f0',
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.selectedAnchor.renderOrder = 1001;
    this.selectionGroup.add(this.selectedAnchor);

    this.selectedTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 18, 12),
      new THREE.MeshBasicMaterial({ color: '#ffd166', depthTest: false }),
    );
    this.selectedTip.renderOrder = 1001;
    this.selectionGroup.add(this.selectedTip);
    this.selectionGroup.visible = false;
  }

  private buildRawLine(): void {
    this.rawLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#00b4d8', linewidth: 2, depthTest: false }),
    );
    this.rawLine.renderOrder = 1100;
    this.rawLine.frustumCulled = false;
    this.scene.add(this.rawLine);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    if (this.cameraTween) {
      const elapsed = performance.now() - this.cameraTween.start;
      const t = Math.min(1, elapsed / this.cameraTween.duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.position.lerpVectors(
        this.cameraTween.fromPosition,
        this.cameraTween.toPosition,
        eased,
      );
      this.controls.target.lerpVectors(
        this.cameraTween.fromTarget,
        this.cameraTween.toTarget,
        eased,
      );
      if (t >= 1) this.cameraTween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private startCameraTween(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    this.cameraTween = {
      start: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  private rebuildBrows(): void {
    (['left', 'right'] as Side[]).forEach((side) => {
      const old = this.browViews.get(side);
      if (old) {
        this.browGroup.remove(old.body);
        if (old.hairs) this.browGroup.remove(old.hairs);
        old.body.geometry.dispose();
        old.body.material.dispose();
        old.pick.geometry.dispose();
        old.pick.material.dispose();
        if (old.hairs) {
          old.hairs.geometry.dispose();
          (old.hairs.material as THREE.Material).dispose();
        }
        this.browViews.delete(side);
      }
      // Pick meshes live in a separate group; clear below safely by userData.
    });

    this.browPickGroup.clear();
    const doc = this.bridge.getDoc();

    (['left', 'right'] as Side[]).forEach((side) => {
      const brow = doc.brows[side];
      if (!brow || brow.points.length < 2) return;
      const geometry = buildBrowRibbonGeometry(brow);
      if (!geometry) return;
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: brow.color,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.94,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const body = new THREE.Mesh(geometry, bodyMaterial);
      body.userData = { kind: 'brow', side };
      this.browGroup.add(body);

      const pickGeometry = buildBrowRibbonGeometry(brow, 2.35);
      const pickMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const pick = new THREE.Mesh(pickGeometry ?? geometry.clone(), pickMaterial);
      pick.userData = { kind: 'brow', side };
      this.browPickGroup.add(pick);

      const hairs = buildBrowHairs(brow);
      this.browGroup.add(hairs);
      this.browViews.set(side, { body, pick, hairs });
    });
  }

  private updateBrowLive(side: Side): void {
    const doc = this.bridge.getDoc();
    const brow = doc.brows[side];
    const view = this.browViews.get(side);
    if (!brow || brow.points.length < 2 || !view) {
      this.rebuildBrows();
      return;
    }

    const geometry = buildBrowRibbonGeometry(brow);
    if (geometry) {
      view.body.geometry.dispose();
      view.body.geometry = geometry;
    }
    const pickGeometry = buildBrowRibbonGeometry(brow, 2.35);
    if (pickGeometry) {
      view.pick.geometry.dispose();
      view.pick.geometry = pickGeometry;
    }
    if (view.hairs) updateBrowHairs(view.hairs, brow);
    this.updateHandleTransforms();
  }

  private clearHandleGroup(): void {
    for (const child of [...this.handleGroup.children]) {
      child.traverse((object) => {
        const renderable = object as THREE.Mesh;
        renderable.geometry?.dispose();
        const material = renderable.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      child.removeFromParent();
    }
    this.widthHandle = null;
    this.widthLine = null;
  }

  private rebuildHandles(): void {
    this.clearHandleGroup();
    const doc = this.bridge.getDoc();

    (['left', 'right'] as Side[]).forEach((side) => {
      const brow = doc.brows[side];
      brow.points.forEach((point) => {
        const selected = this.selection.browPointId === point.id;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(selected ? 0.047 : 0.036, 22, 14),
          new THREE.MeshBasicMaterial({
            color: selected ? '#fff3b0' : '#ffca3a',
            depthTest: false,
            depthWrite: false,
          }),
        );
        mesh.position.set(point.x, point.y, surfaceZ(point.x, point.y) + 0.11);
        mesh.renderOrder = 1200;
        mesh.userData = { kind: 'browPoint', side, pointId: point.id };
        this.handleGroup.add(mesh);
      });
    });

    const context = this.getSelectedPointContext();
    if (context) {
      const geometry = new THREE.OctahedronGeometry(0.052, 0);
      this.widthHandle = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: '#4cc9f0',
          depthTest: false,
          depthWrite: false,
        }),
      );
      this.widthHandle.renderOrder = 1202;
      this.widthHandle.userData = {
        kind: 'browWidth',
        side: context.side,
        pointId: context.point.id,
      };
      this.handleGroup.add(this.widthHandle);

      this.widthLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]),
        new THREE.LineBasicMaterial({ color: '#4cc9f0', depthTest: false, transparent: true }),
      );
      this.widthLine.renderOrder = 1201;
      this.handleGroup.add(this.widthLine);
      this.updateWidthHandleTransform();
    }

    this.handleGroup.visible = this.mode === 'brow';
  }

  private getSelectedPointContext(): {
    side: Side;
    brow: ProjectDocument['brows'][Side];
    point: ProjectDocument['brows'][Side]['points'][number];
    index: number;
  } | null {
    const id = this.selection.browPointId;
    if (!id) return null;
    const doc = this.bridge.getDoc();
    const preferred = this.selection.side;
    const sides: Side[] = [preferred, preferred === 'left' ? 'right' : 'left'];
    for (const side of sides) {
      const brow = doc.brows[side];
      const index = brow.points.findIndex((p) => p.id === id);
      if (index >= 0) return { side, brow, point: brow.points[index], index };
    }
    return null;
  }

  private widthHandlePosition(
    context: NonNullable<ReturnType<SceneManager['getSelectedPointContext']>>,
    out = new THREE.Vector3(),
  ): THREE.Vector3 {
    const { brow, point, index } = context;
    const prev = brow.points[Math.max(0, index - 1)] ?? point;
    const next = brow.points[Math.min(brow.points.length - 1, index + 1)] ?? point;
    const tangent = new THREE.Vector3(next.x - prev.x, next.y - prev.y, 0);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
    tangent.normalize();
    const perp = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
    if (perp.y < 0) perp.negate();
    const distance = point.width + 0.105;
    const x = point.x + perp.x * distance;
    const y = point.y + perp.y * distance + 0.025;
    return out.set(x, y, surfaceZ(x, y) + 0.14);
  }

  private updateWidthHandleTransform(): void {
    const context = this.getSelectedPointContext();
    if (!context || !this.widthHandle || !this.widthLine) return;
    const target = this.widthHandlePosition(context, new THREE.Vector3());
    this.widthHandle.position.copy(target);
    const start = new THREE.Vector3(
      context.point.x,
      context.point.y,
      surfaceZ(context.point.x, context.point.y) + 0.12,
    );
    const attr = this.widthLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, start.x, start.y, start.z);
    attr.setXYZ(1, target.x, target.y, target.z);
    attr.needsUpdate = true;
    this.widthLine.geometry.computeBoundingSphere();
  }

  private updateHandleTransforms(): void {
    const doc = this.bridge.getDoc();
    for (const child of this.handleGroup.children) {
      const data = child.userData as { kind?: string; side?: Side; pointId?: string };
      if (data.kind !== 'browPoint' || !data.side || !data.pointId) continue;
      const point = doc.brows[data.side].points.find((p) => p.id === data.pointId);
      if (!point) continue;
      child.position.set(point.x, point.y, surfaceZ(point.x, point.y) + 0.11);
    }
    this.updateWidthHandleTransform();
  }

  private updateSelectionHelper(): void {
    if (!this.selection.lashId) {
      this.selectionGroup.visible = false;
      return;
    }
    const doc = this.bridge.getDoc();
    const lash = doc.lashes.find((l) => l.id === this.selection.lashId);
    if (!lash) {
      this.selectionGroup.visible = false;
      return;
    }
    const row = lash.rowId ? doc.rows.find((r) => r.id === lash.rowId) : undefined;
    const centers = getLashCenters(lash, row, 28);
    this.selectedLashLine.geometry.dispose();
    this.selectedLashLine.geometry = new THREE.BufferGeometry().setFromPoints(centers);
    this.selectedAnchor.position.copy(centers[0]);
    const normal = surfaceNormal(centers[0].x, centers[0].y, new THREE.Vector3());
    this.selectedAnchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.selectedTip.position.copy(centers[centers.length - 1]);
    this.selectionGroup.visible = true;
  }

  private updateCursor(): void {
    if (this.drag) return;
    if (this.tool === 'erase') this.renderer.domElement.style.cursor = 'cell';
    else if (this.tool === 'draw') this.renderer.domElement.style.cursor = 'crosshair';
    else this.renderer.domElement.style.cursor = 'default';
  }

  private updateHoverCursor(event: PointerEvent): void {
    const hits = this.raycast(event);
    const handle = this.findHandleHit(hits);
    if (handle) {
      this.renderer.domElement.style.cursor = 'grab';
      return;
    }
    const lashHit = hits.find((h) => this.dataOf(h.object)?.kind === 'lashBatch');
    if (this.mode === 'lash' && lashHit) {
      this.renderer.domElement.style.cursor = 'pointer';
      return;
    }
    this.updateCursor();
  }

  private dataOf(object: THREE.Object3D | null): Record<string, unknown> | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData && typeof current.userData.kind === 'string') {
        return current.userData as Record<string, unknown>;
      }
      current = current.parent;
    }
    return null;
  }

  private raycast(event: PointerEvent): THREE.Intersection[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(
      [
        this.handleGroup,
        this.browGroup,
        this.browPickGroup,
        this.lashBatch.mesh,
        this.eyelidHitGroup,
        this.faceMesh,
      ],
      true,
    );
  }

  private findHandleHit(hits: THREE.Intersection[]): THREE.Intersection | null {
    for (const hit of hits) {
      const data = this.dataOf(hit.object);
      if (data?.kind === 'browPoint' || data?.kind === 'browWidth') return hit;
    }
    return null;
  }

  private startRawLine(point: THREE.Vector3): void {
    this.rawPoints = [{ x: point.x, y: point.y }];
    this.syncRawLine();
  }

  private appendRawPoint(point: THREE.Vector3): void {
    const last = this.rawPoints[this.rawPoints.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.014) return;
    this.rawPoints.push({ x: point.x, y: point.y });
    this.syncRawLine();
  }

  private syncRawLine(): void {
    const points = this.rawPoints.map(
      (p) => new THREE.Vector3(p.x, p.y, surfaceZ(p.x, p.y) + 0.12),
    );
    this.rawLine.geometry.dispose();
    this.rawLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  private clearRawLine(): void {
    this.rawPoints = [];
    this.rawLine.geometry.dispose();
    this.rawLine.geometry = new THREE.BufferGeometry();
  }

  private eraseAt(hits: THREE.Intersection[]): 'lash' | 'brow' | null {
    for (const hit of hits) {
      const data = this.dataOf(hit.object);
      if (data?.kind === 'lashBatch') {
        const id = this.lashBatch.pickLashId(hit.faceIndex ?? null);
        if (!id) continue;
        this.bridge.transact((doc) => {
          doc.lashes = doc.lashes.filter((lash) => lash.id !== id);
        });
        const doc = this.bridge.getDoc();
        this.lashBatch.rebuild(doc.lashes, doc.rows);
        if (this.selection.lashId === id) {
          const patch = { lashId: null, rowId: null };
          this.selection = { ...this.selection, ...patch };
          this.bridge.onSelection(patch);
          this.updateSelectionHelper();
        }
        return 'lash';
      }
      if (data?.kind === 'brow') {
        const side = data.side as Side;
        this.bridge.transact((doc) => eraseBrow(doc, side));
        this.rebuildBrows();
        const patch: SelectionPatch = { browPointId: null };
        if (this.selection.side === side) patch.browPointId = null;
        this.selection = { ...this.selection, browPointId: null };
        this.bridge.onSelection(patch);
        return 'brow';
      }
    }
    return null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const hits = this.raycast(event);

    const handleHit = this.findHandleHit(hits);
    if (handleHit) {
      event.preventDefault();
      const data = this.dataOf(handleHit.object)!;
      const side = data.side as Side;
      const pointId = data.pointId as string;
      const patch: SelectionPatch = {
        side,
        browPointId: pointId,
        lashId: null,
        rowId: null,
      };
      this.selection = { ...this.selection, ...patch };
      this.bridge.onSelection(patch);
      this.rebuildHandles();
      this.bridge.beginHistory();
      const unilateral = event.altKey || this.unilateralFineTune;
      if (unilateral) {
        this.bridge.transact((doc) => breakPointMirror(doc, side, pointId));
      }
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture?.(event.pointerId);
      this.renderer.domElement.style.cursor = 'grabbing';

      if (data.kind === 'browWidth') {
        const point = this.bridge
          .getDoc()
          .brows[side].points.find((p) => p.id === pointId);
        this.drag = {
          type: 'browWidth',
          side,
          pointId,
          pointerId: event.pointerId,
          startY: event.clientY,
          startWidth: point?.width ?? 0.08,
        };
      } else {
        this.drag = { type: 'browPoint', side, pointId, pointerId: event.pointerId };
      }
      return;
    }

    if (this.tool === 'erase') {
      this.bridge.beginHistory();
      const erased = this.eraseAt(hits);
      if (erased) {
        event.preventDefault();
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture?.(event.pointerId);
        this.drag = { type: 'erase', pointerId: event.pointerId };
      } else {
        this.bridge.endHistory();
      }
      return;
    }

    if (this.mode === 'lash') {
      const lashHit = hits.find((h) => this.dataOf(h.object)?.kind === 'lashBatch');
      if (lashHit) {
        const id = this.lashBatch.pickLashId(lashHit.faceIndex ?? null);
        const lash = id ? this.bridge.getDoc().lashes.find((l) => l.id === id) : null;
        if (id && lash) {
          event.preventDefault();
          const patch: SelectionPatch = {
            side: lash.side,
            lashId: id,
            rowId: lash.rowId,
            browPointId: null,
          };
          this.selection = { ...this.selection, ...patch };
          this.bridge.onSelection(patch);
          this.updateSelectionHelper();
          this.bridge.beginHistory();
          this.controls.enabled = false;
          this.renderer.domElement.setPointerCapture?.(event.pointerId);
          this.drag = { type: 'lash', id, pointerId: event.pointerId };
          return;
        }
      }

      const eyelidHit = hits.find((h) => this.dataOf(h.object)?.kind === 'eyelid');
      if (eyelidHit && this.tool === 'draw') {
        event.preventDefault();
        const side = this.dataOf(eyelidHit.object)?.side as Side;
        const t = nearestEyelidT(side, eyelidHit.point);
        const lash = makeLash({ side, t });
        this.bridge.beginHistory();
        this.bridge.transact((doc) => {
          doc.lashes.push(lash);
        });
        this.lashBatch.rebuild(this.bridge.getDoc().lashes, this.bridge.getDoc().rows);
        const patch: SelectionPatch = {
          side,
          lashId: lash.id,
          rowId: null,
          browPointId: null,
        };
        this.selection = { ...this.selection, ...patch };
        this.bridge.onSelection(patch);
        this.updateSelectionHelper();
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture?.(event.pointerId);
        this.drag = { type: 'newLash', id: lash.id, pointerId: event.pointerId };
      }
      return;
    }

    if (this.mode === 'brow') {
      if (this.tool === 'draw') {
        const faceHit = hits.find((h) => this.dataOf(h.object)?.kind === 'face');
        if (faceHit) {
          event.preventDefault();
          const side: Side = faceHit.point.x < 0 ? 'left' : 'right';
          const patch: SelectionPatch = { side, browPointId: null, lashId: null, rowId: null };
          this.selection = { ...this.selection, ...patch };
          this.bridge.onSelection(patch);
          this.startRawLine(faceHit.point);
          this.controls.enabled = false;
          this.renderer.domElement.setPointerCapture?.(event.pointerId);
          this.drag = { type: 'drawBrow', side, pointerId: event.pointerId };
        }
        return;
      }

      const browHit = hits.find((h) => this.dataOf(h.object)?.kind === 'brow');
      if (browHit) {
        const side = this.dataOf(browHit.object)?.side as Side;
        const patch: SelectionPatch = { side, browPointId: null, lashId: null, rowId: null };
        this.selection = { ...this.selection, ...patch };
        this.bridge.onSelection(patch);
        this.rebuildHandles();
      }
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) {
      this.updateHoverCursor(event);
      return;
    }
    if (this.drag.pointerId !== event.pointerId) return;
    event.preventDefault?.();
    const hits = this.raycast(event);
    const drag = this.drag;

    if (drag.type === 'erase') {
      this.eraseAt(hits);
      return;
    }

    if (drag.type === 'drawBrow') {
      const faceHit = hits.find((h) => this.dataOf(h.object)?.kind === 'face');
      if (faceHit) this.appendRawPoint(faceHit.point);
      return;
    }

    if (drag.type === 'browPoint') {
      const faceHit = hits.find((h) => this.dataOf(h.object)?.kind === 'face');
      if (!faceHit) return;
      this.bridge.transact((doc) => {
        const point = doc.brows[drag.side].points.find((p) => p.id === drag.pointId);
        if (!point) return;
        point.x = faceHit.point.x;
        point.y = faceHit.point.y;
        syncBrowMirror(doc, drag.side);
      });
      this.updateBrowLive(drag.side);
      this.updateBrowLive(otherSide(drag.side));
      return;
    }

    if (drag.type === 'browWidth') {
      const context = this.getSelectedPointContext();
      if (!context) return;
      const distance = this.camera.position.distanceTo(this.controls.target);
      const worldPerPixel =
        (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))) /
        Math.max(1, this.renderer.domElement.clientHeight);
      const width = THREE.MathUtils.clamp(
        drag.startWidth + (drag.startY - event.clientY) * worldPerPixel * 1.45,
        0.016,
        0.19,
      );
      this.bridge.transact((doc) => {
        const point = doc.brows[drag.side].points.find((p) => p.id === drag.pointId);
        if (!point) return;
        point.width = width;
        syncBrowMirror(doc, drag.side);
      });
      this.updateBrowLive(drag.side);
      this.updateBrowLive(otherSide(drag.side));
      return;
    }

    if (drag.type === 'lash' || drag.type === 'newLash') {
      const doc = this.bridge.getDoc();
      const lash = doc.lashes.find((l) => l.id === drag.id);
      if (!lash) return;
      let t: number | null = null;
      const lidHit = hits.find(
        (h) =>
          this.dataOf(h.object)?.kind === 'eyelid' &&
          (this.dataOf(h.object)?.side as Side) === lash.side,
      );
      if (lidHit) t = nearestEyelidT(lash.side, lidHit.point);
      else {
        const faceHit = hits.find((h) => this.dataOf(h.object)?.kind === 'face');
        if (faceHit) t = nearestEyelidT(lash.side, faceHit.point);
      }
      if (t === null) return;
      const nextT = THREE.MathUtils.clamp(t, 0.01, 0.99);
      this.bridge.transact((draft) => {
        const target = draft.lashes.find((l) => l.id === drag.id);
        if (target) target.t = nextT;
      });
      const updated = this.bridge.getDoc().lashes.find((l) => l.id === drag.id);
      if (updated) this.lashBatch.updateLash(updated, this.bridge.getDoc().rows);
      this.updateSelectionHelper();
    }
  };

  private finishPointer(event: PointerEvent, canceled: boolean): void {
    const drag = this.drag;
    if (drag?.type === 'drawBrow' && !canceled) {
      const raw = [...this.rawPoints];
      this.clearRawLine();
      if (raw.length >= 2) {
        let ok = false;
        this.bridge.commit((doc) => {
          ok = replaceBrowFromStroke(doc, drag.side, raw);
        });
        if (ok) {
          const patch: SelectionPatch = { side: drag.side, browPointId: null };
          this.selection = { ...this.selection, ...patch };
          this.bridge.onSelection(patch);
          this.refresh('brows');
        }
      } else {
        this.clearRawLine();
      }
    }

    this.drag = null;
    this.controls.enabled = true;
    this.bridge.endHistory();
    this.updateCursor();
    if (event.pointerId !== undefined && this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  private onPointerUp = (event: PointerEvent): void => this.finishPointer(event, false);
  private onPointerCancel = (event: PointerEvent): void => this.finishPointer(event, true);
  private onPointerLeave = (): void => {
    if (!this.drag) this.updateCursor();
  };
}
