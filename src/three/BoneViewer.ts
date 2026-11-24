import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type {
  AssemblyGroup,
  CorrespondencePair,
  RegistrationReport,
  Vec3Tuple,
} from '../types';
import { applyPoseToObject3D, principalAxisFromPositions } from '../lib/utils';

export interface ViewerCallbacks {
  onSelect: (fragmentId: string | null, additive: boolean) => void;
  onPick: (fragmentId: string, local: Vec3Tuple, world: Vec3Tuple) => void;
  onTransformEnd: () => void;
}

interface PairView {
  pairId: string;
  markerA: THREE.Mesh;
  markerB: THREE.Mesh;
  line: THREE.Line;
}

const SELECTED_EMISSIVE: Record<number, number> = {
  0: 0x0891b2,
  1: 0xea580c,
};

export class BoneViewer {
  readonly container: HTMLElement;
  private readonly callbacks: ViewerCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly transform: TransformControls;
  private readonly transformHelper: THREE.Object3D;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;

  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly groups = new Map<string, THREE.Group>();
  private selectedIds: string[] = [];
  private pickEnabled = false;

  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;
  private readonly pairRoot = new THREE.Group();
  private readonly evaluationRoot = new THREE.Group();
  private readonly interferenceRoot = new THREE.Group();
  private readonly referenceRoot = new THREE.Group();
  private intersectionMesh: THREE.Mesh | null = null;

  private readonly pairViews = new Map<string, PairView>();
  private readonly sharedPointGeometry = new THREE.SphereGeometry(1, 18, 12);
  private readonly pointMaterialA = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    depthTest: false,
  });
  private readonly pointMaterialB = new THREE.MeshBasicMaterial({
    color: 0xfb923c,
    depthTest: false,
  });
  private markerRadius = 0.08;

  private pointerDown = { x: 0, y: 0, at: 0, axis: null as string | null };
  private dragEndedAt = 0;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: ViewerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'three-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0b1220);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000);
    this.camera.position.set(6, 5, 8);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.05;
    this.orbit.maxDistance = 800;
    this.orbit.target.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.65);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(8, 12, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.8);
    fill.position.set(-8, 4, -6);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(80, 40, 0x38bdf8, 0x243449);
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.34;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(2.2);
    this.scene.add(this.axes);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.setSize(0.9);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
      if (!event.value) {
        this.dragEndedAt = performance.now();
        this.callbacks.onTransformEnd();
      }
    });

    this.pairRoot.name = 'correspondence-helpers';
    this.evaluationRoot.name = 'residual-helpers';
    this.interferenceRoot.name = 'interference-helpers';
    this.referenceRoot.name = 'reference-axis-helpers';
    this.scene.add(this.pairRoot, this.evaluationRoot, this.interferenceRoot, this.referenceRoot);

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.renderer.setAnimationLoop(this.renderFrame);
  }

  private renderFrame = (): void => {
    if (this.disposed) return;
    this.orbit.update();
    this.updatePairLines();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  addFragment(id: string, geometry: THREE.BufferGeometry, color: string, visible = true): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.72,
      metalness: 0.06,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.55,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.fragmentId = id;
    mesh.visible = visible;
    mesh.frustumCulled = true;
    this.meshes.set(id, mesh);
    this.scene.add(mesh);
    return mesh;
  }

  attachFragmentToGroup(id: string, groupId: string): void {
    const mesh = this.meshes.get(id);
    const group = this.groups.get(groupId);
    if (!mesh || !group) return;
    group.attach(mesh);
    mesh.userData.groupId = groupId;
  }

  upsertGroup(record: AssemblyGroup, attachExisting = false): THREE.Group {
    let group = this.groups.get(record.id);
    if (!group) {
      group = new THREE.Group();
      group.name = record.name;
      group.userData.groupId = record.id;
      this.groups.set(record.id, group);
      this.scene.add(group);
    }
    group.name = record.name;
    applyPoseToObject3D(group, record.pose);

    if (attachExisting) {
      for (const memberId of record.memberIds) {
        const mesh = this.meshes.get(memberId);
        if (mesh && mesh.parent !== group) {
          group.attach(mesh);
          mesh.userData.groupId = record.id;
        }
      }
    }
    group.updateMatrixWorld(true);
    return group;
  }

  splitGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    this.transform.detach();
    const children = [...group.children];
    for (const child of children) {
      if (child instanceof THREE.Mesh && child.userData.fragmentId) {
        this.scene.attach(child);
        child.userData.groupId = null;
      }
    }
    this.scene.remove(group);
    this.groups.delete(groupId);
    this.refreshSelectionAttach();
  }

  removeFragment(id: string): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    if (this.transform.object === mesh) this.transform.detach();
    mesh.removeFromParent();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
    this.meshes.delete(id);
    this.removePairViewsForFragment(id);
  }

  clearAll(): void {
    this.transform.detach();
    for (const id of [...this.meshes.keys()]) this.removeFragment(id);
    for (const group of this.groups.values()) this.scene.remove(group);
    this.groups.clear();
    this.clearPairViews();
    this.clearEvaluation();
    this.clearIntersection();
    this.clearReferenceAxis();
    this.selectedIds = [];
  }

  setFragmentColor(id: string, color: string): void {
    const mesh = this.meshes.get(id);
    if (mesh?.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.color.set(color);
    }
  }

  setFragmentVisible(id: string, visible: boolean): void {
    const mesh = this.meshes.get(id);
    if (mesh) mesh.visible = visible;
  }

  setFragmentOpacity(id: string, opacity: number): void {
    const mesh = this.meshes.get(id);
    if (!(mesh?.material instanceof THREE.MeshStandardMaterial)) return;
    mesh.material.opacity = opacity;
    mesh.material.transparent = opacity < 0.999;
    mesh.material.depthWrite = opacity >= 0.999;
    mesh.material.needsUpdate = true;
  }

  setTool(tool: 'translate' | 'rotate'): void {
    this.transform.setMode(tool);
  }

  setPickEnabled(enabled: boolean): void {
    this.pickEnabled = enabled;
    this.transform.enabled = !enabled;
    this.renderer.domElement.style.cursor = enabled ? 'crosshair' : '';
    if (enabled) this.transform.detach();
    else this.refreshSelectionAttach();
  }

  setSelection(ids: string[]): void {
    this.selectedIds = [...ids];
    this.refreshHighlights();
    if (!this.pickEnabled) this.refreshSelectionAttach();
  }

  private refreshSelectionAttach(): void {
    this.transform.detach();
    const activeId = this.selectedIds.at(-1);
    if (!activeId || this.pickEnabled) return;
    const mesh = this.meshes.get(activeId);
    if (!mesh) return;
    const groupId = mesh.userData.groupId as string | null | undefined;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (group) {
      this.pivotGroupAtMeshCenter(group, mesh);
      this.transform.attach(group);
      // Pivoting rewrites local poses without changing world transforms.
      this.callbacks.onTransformEnd();
    } else {
      this.transform.attach(mesh);
    }
  }

  /**
   * Put the group's pivot at the selected member's bounding-box center while
   * preserving every member's world transform. The gizmo therefore stays on
   * the clicked fragment even though TransformControls drives the whole group.
   */
  private pivotGroupAtMeshCenter(group: THREE.Group, activeMesh: THREE.Mesh): void {
    group.updateWorldMatrix(true, false);
    activeMesh.updateWorldMatrix(true, false);
    const center = new THREE.Box3().setFromObject(activeMesh).getCenter(new THREE.Vector3());
    const pivotWorld = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);

    const children = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const worldMatrices = children.map((child) => child.matrixWorld.clone());

    pivotWorld.decompose(group.position, group.quaternion, group.scale);
    group.updateMatrix();
    group.updateMatrixWorld(false);
    const groupInverse = group.matrixWorld.clone().invert();

    children.forEach((child, index) => {
      const localMatrix = new THREE.Matrix4().multiplyMatrices(groupInverse, worldMatrices[index]);
      localMatrix.decompose(child.position, child.quaternion, child.scale);
      child.updateMatrix();
    });
    group.updateMatrixWorld(true);
  }

  private refreshHighlights(): void {
    for (const [id, mesh] of this.meshes) {
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      const selectedIndex = this.selectedIds.indexOf(id);
      if (selectedIndex === 0 || selectedIndex === 1) {
        mesh.material.emissive.setHex(SELECTED_EMISSIVE[selectedIndex]);
        mesh.material.emissiveIntensity = 0.42;
      } else if (selectedIndex >= 0) {
        mesh.material.emissive.setHex(0x1d4ed8);
        mesh.material.emissiveIntensity = 0.38;
      } else {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    }
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  setAxesVisible(visible: boolean): void {
    this.axes.visible = visible;
  }

  private updatePointerFromEvent(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickFragment(event: PointerEvent): { id: string; point: THREE.Vector3; local: THREE.Vector3 } | null {
    this.updatePointerFromEvent(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects = [...this.meshes.values()].filter((mesh) => mesh.visible);
    const hits = this.raycaster.intersectObjects(objects, false);
    const hit = hits[0];
    if (!hit) return null;
    const mesh = hit.object as THREE.Mesh;
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(hit.point.clone());
    return { id: mesh.userData.fragmentId as string, point: hit.point.clone(), local };
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.pickEnabled) {
      const hit = this.pickFragment(event);
      this.renderer.domElement.style.cursor = hit ? 'pointer' : 'crosshair';
    }
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      axis: this.transform.axis,
    };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (performance.now() - this.dragEndedAt < 120) return;
    if (this.pointerDown.axis || this.transform.axis || this.transform.dragging) return;
    const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    const elapsed = performance.now() - this.pointerDown.at;
    if (distance > 6 || elapsed > 700) return;

    const hit = this.pickFragment(event);
    if (this.pickEnabled) {
      if (hit) {
        this.callbacks.onPick(
          hit.id,
          [hit.local.x, hit.local.y, hit.local.z],
          [hit.point.x, hit.point.y, hit.point.z],
        );
      }
      return;
    }

    this.callbacks.onSelect(hit?.id ?? null, event.ctrlKey || event.metaKey || event.shiftKey);
  };

  computeSceneBox(selectedOnly = false): THREE.Box3 {
    const box = new THREE.Box3();
    if (selectedOnly && this.selectedIds.length) {
      for (const id of this.selectedIds) {
        const mesh = this.meshes.get(id);
        if (mesh) box.expandByObject(mesh);
      }
    } else {
      for (const mesh of this.meshes.values()) box.expandByObject(mesh);
    }
    return box;
  }

  frameAll(): void {
    this.frameBox(this.computeSceneBox());
  }

  frameSelected(): void {
    this.frameBox(this.computeSceneBox(true));
  }

  private frameBox(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.1);
    this.markerRadius = THREE.MathUtils.clamp(radius * 0.035, 0.035, 1.2);
    for (const view of this.pairViews.values()) {
      view.markerA.scale.setScalar(this.markerRadius * 0.72);
      view.markerB.scale.setScalar(this.markerRadius * 0.72);
    }

    const direction = new THREE.Vector3(1.15, 0.75, 1.35).normalize();
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * 1.25;
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(radius / 1000, 0.001);
    this.camera.far = radius * 100;
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(center);
    this.orbit.maxDistance = radius * 30;
    this.orbit.update();
  }

  getMesh(id: string): THREE.Mesh | undefined {
    return this.meshes.get(id);
  }

  getGroupObject(groupId: string): THREE.Group | undefined {
    return this.groups.get(groupId);
  }

  getFragmentWorldMatrix(id: string): THREE.Matrix4 {
    const mesh = this.meshes.get(id);
    if (!mesh) throw new Error(`未找到碎片对象: ${id}`);
    mesh.updateWorldMatrix(true, false);
    return mesh.matrixWorld.clone();
  }

  setFragmentWorldMatrix(id: string, worldMatrix: THREE.Matrix4): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    const parent = mesh.parent ?? this.scene;
    parent.updateWorldMatrix(true, false);
    const localMatrix = parent.matrixWorld.clone().invert().multiply(worldMatrix);
    localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }

  getPrincipalAxis(id: string): { origin: Vec3Tuple; axis: THREE.Vector3 } {
    const mesh = this.meshes.get(id);
    if (!mesh) throw new Error('请选择参考碎片');
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const axisLocal = principalAxisFromPositions(position.array as ArrayLike<number>);
    mesh.updateWorldMatrix(true, false);
    const axis = axisLocal.clone().transformDirection(mesh.matrixWorld).normalize();
    const box = new THREE.Box3().setFromObject(mesh);
    const origin = box.getCenter(new THREE.Vector3());
    return { origin: [origin.x, origin.y, origin.z], axis };
  }

  alignAllToAxis(sourceAxis: THREE.Vector3, targetAxis: THREE.Vector3): void {
    const source = sourceAxis.clone().normalize();
    const target = targetAxis.clone().normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(source, target);
    const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
    const box = this.computeSceneBox();
    const pivot = box.getCenter(new THREE.Vector3());
    const pivotToOrigin = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const originToPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
    const alignment = originToPivot.multiply(rotationMatrix).multiply(pivotToOrigin);

    const topLevel = new Set<THREE.Object3D>();
    for (const group of this.groups.values()) topLevel.add(group);
    for (const mesh of this.meshes.values()) {
      const groupId = mesh.userData.groupId as string | null | undefined;
      if (!groupId || !this.groups.has(groupId)) topLevel.add(mesh);
    }

    this.transform.detach();
    for (const object of topLevel) {
      object.matrix.premultiply(alignment);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.updateMatrixWorld(true);
    }
    this.refreshSelectionAttach();
    this.callbacks.onTransformEnd();
  }

  renderPairs(pairs: CorrespondencePair[]): void {
    this.clearPairViews();
    for (const pair of pairs) {
      const meshA = this.meshes.get(pair.aId);
      const meshB = this.meshes.get(pair.bId);
      if (!meshA || !meshB) continue;

      const markerA = new THREE.Mesh(this.sharedPointGeometry, this.pointMaterialA);
      markerA.position.fromArray(pair.aLocal);
      markerA.scale.setScalar(this.markerRadius * 0.72);
      markerA.renderOrder = 20;
      const markerB = new THREE.Mesh(this.sharedPointGeometry, this.pointMaterialB);
      markerB.position.fromArray(pair.bLocal);
      markerB.scale.setScalar(this.markerRadius * 0.72);
      markerB.renderOrder = 20;
      meshA.add(markerA);
      meshB.add(markerB);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.renderOrder = 15;
      this.pairRoot.add(line);
      this.pairViews.set(pair.id, { pairId: pair.id, markerA, markerB, line });
    }
    this.updatePairLines();
  }

  private updatePairLines(): void {
    const aWorld = new THREE.Vector3();
    const bWorld = new THREE.Vector3();
    for (const view of this.pairViews.values()) {
      view.markerA.getWorldPosition(aWorld);
      view.markerB.getWorldPosition(bWorld);
      const attribute = view.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      attribute.setXYZ(0, aWorld.x, aWorld.y, aWorld.z);
      attribute.setXYZ(1, bWorld.x, bWorld.y, bWorld.z);
      attribute.needsUpdate = true;
    }
  }

  private removePairViewsForFragment(fragmentId: string): void {
    for (const [pairId, view] of this.pairViews) {
      if (view.markerA.parent?.userData.fragmentId === fragmentId ||
          view.markerB.parent?.userData.fragmentId === fragmentId) {
        view.markerA.removeFromParent();
        view.markerB.removeFromParent();
        this.pairRoot.remove(view.line);
        view.line.geometry.dispose();
        (view.line.material as THREE.Material).dispose();
        this.pairViews.delete(pairId);
      }
    }
  }

  private clearPairViews(): void {
    for (const view of this.pairViews.values()) {
      view.markerA.removeFromParent();
      view.markerB.removeFromParent();
      this.pairRoot.remove(view.line);
      view.line.geometry.dispose();
      (view.line.material as THREE.Material).dispose();
    }
    this.pairViews.clear();
  }

  showRegistration(report: RegistrationReport | null, arrowsEnabled: boolean): void {
    this.clearEvaluation();
    if (!report || !arrowsEnabled) return;

    for (const residual of report.residuals) {
      if (!residual.overThreshold || residual.distance < 1e-6) continue;
      const origin = new THREE.Vector3(...residual.aWorld);
      const direction = new THREE.Vector3(...residual.direction);
      if (direction.lengthSq() < 1e-10) continue;
      direction.normalize();
      const headLength = THREE.MathUtils.clamp(residual.distance * 0.28, this.markerRadius * 0.35, this.markerRadius * 1.4);
      const headWidth = headLength * 0.58;
      const arrow = new THREE.ArrowHelper(
        direction,
        origin,
        residual.distance,
        0xef4444,
        headLength,
        headWidth,
      );
      const lineMaterial = arrow.line.material as THREE.LineBasicMaterial;
      const coneMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
      lineMaterial.depthTest = false;
      coneMaterial.depthTest = false;
      arrow.renderOrder = 30;
      this.evaluationRoot.add(arrow);
    }
  }

  private clearEvaluation(): void {
    for (const child of [...this.evaluationRoot.children]) {
      this.evaluationRoot.remove(child);
      if (child instanceof THREE.ArrowHelper) {
        child.line.geometry.dispose();
        (child.line.material as THREE.Material).dispose();
        child.cone.geometry.dispose();
        (child.cone.material as THREE.Material).dispose();
      }
    }
  }

  showIntersectionGeometry(geometry: THREE.BufferGeometry | null): void {
    this.clearIntersection();
    if (!geometry) return;
    const material = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.intersectionMesh = new THREE.Mesh(geometry, material);
    this.intersectionMesh.renderOrder = 25;
    this.interferenceRoot.add(this.intersectionMesh);
  }

  private clearIntersection(): void {
    if (this.intersectionMesh) {
      this.intersectionMesh.removeFromParent();
      this.intersectionMesh.geometry.dispose();
      (this.intersectionMesh.material as THREE.Material).dispose();
      this.intersectionMesh = null;
    }
  }

  showReferenceAxis(origin: Vec3Tuple, axis: THREE.Vector3, length: number | null = null): void {
    this.clearReferenceAxis();
    const arrowLength = length ?? this.markerRadius * 6;
    const arrow = new THREE.ArrowHelper(axis.clone().normalize(), new THREE.Vector3(...origin), arrowLength, 0xfacc15, arrowLength * 0.18, arrowLength * 0.1);
    this.referenceRoot.add(arrow);
  }

  clearReferenceAxis(): void {
    for (const child of [...this.referenceRoot.children]) {
      if (child instanceof THREE.ArrowHelper) {
        child.line.geometry.dispose();
        (child.line.material as THREE.Material).dispose();
        child.cone.geometry.dispose();
        (child.cone.material as THREE.Material).dispose();
      }
      this.referenceRoot.remove(child);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.transform.dispose();
    this.orbit.dispose();
    this.clearPairViews();
    this.clearEvaluation();
    this.clearIntersection();
    this.clearReferenceAxis();
    this.sharedPointGeometry.dispose();
    this.pointMaterialA.dispose();
    this.pointMaterialB.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
