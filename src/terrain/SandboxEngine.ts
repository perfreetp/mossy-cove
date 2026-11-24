import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BASE_Y, BUILDING_COLORS, clamp, MAX_BUILDINGS, MAX_HEIGHT, MIN_HEIGHT,
  STRATA_COLORS, STRATA_NAMES, WORLD_SIZE
} from './config';
import { heightStats, resampleHeightField, sampleHeightWorld } from './heightfield';
import { createDefaultProject, saveStoredProject } from './project';
import { buildRibbonGeometry, buildYCapGeometry, strataColorAtY } from './sections';
import { createTerrainMaterial, type TerrainUniforms } from './terrainMaterial';
import {
  computeNormalRegion, createTerrainGeometry, uploadRowRanges, uploadWholeAttribute
} from './terrainGeometry';
import type {
  BrushSettings, Building, ProjectData, SectionSettings, UiState
} from './types';

interface HistoryEntry {
  label: string;
  before: { heights: Float32Array; buildings: Building[] };
  after: { heights: Float32Array; buildings: Building[] };
}

interface RibbonEntry {
  axis: 'x' | 'z';
  fixed: number;
  mesh: THREE.Mesh;
}

export class SandboxEngine {
  private host: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private resizeObserver?: ResizeObserver;

  private resolution = 256;
  private cell = WORLD_SIZE / 256;
  private heights: Float32Array = new Float32Array(0);
  private buildings: Building[] = [];

  private terrain!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private terrainUniforms!: TerrainUniforms;
  private water!: THREE.Mesh;
  private buildingMesh!: THREE.InstancedMesh;
  private brushRing!: THREE.Mesh;
  private edgeRibbons: RibbonEntry[] = [];
  private cutRibbonX!: THREE.Mesh;
  private cutRibbonZ!: THREE.Mesh;
  private yCap!: THREE.Mesh;
  private yCapMaterial!: THREE.MeshStandardMaterial;

  private xPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10000);
  private yPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10000);
  private zPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10000);

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private strokeBefore: { heights: Float32Array; buildings: Building[] } | null = null;
  private strokeActive = false;
  private lastStamp: { x: number; z: number } | null = null;
  private flattenTarget = 0;
  private saveTimer: number | null = null;
  private disposed = false;
  private scratch: Float32Array = new Float32Array(0);
  private tmpMatrix = new THREE.Matrix4();
  private tmpPosition = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpQuaternion = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();

  private listeners = new Set<() => void>();
  private state: UiState;

  constructor(host: HTMLElement, initial: ProjectData | null) {
    this.host = host;
    const project = initial ?? createDefaultProject();
    this.resolution = project.resolution;
    this.cell = WORLD_SIZE / project.resolution;
    this.heights = Float32Array.from(project.heightField);
    this.scratch = new Float32Array(this.heights.length);
    this.buildings = project.buildings.map((b) => ({ ...b }));
    this.state = this.buildUiState(project);
    this.initThree();
    this.initSceneObjects(project);
    this.bindEvents();
    this.refreshHeightStats(false);
    this.updateClipPlanes();
    this.rebuildBuildings();
    this.rebuildRibbons();
    this.rebuildYCap();
    this.renderer.setAnimationLoop(this.renderFrame);
    this.scheduleSave(300);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): UiState => this.state;

  private emit(patch?: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private buildUiState(project: ProjectData): UiState {
    const stats = heightStats(this.heights);
    const interval = Math.max(0.05, (stats.max - stats.min) / 6);
    return {
      ready: true,
      name: project.name,
      tool: 'sculpt',
      brush: { type: 'raise', radius: 2.4, strength: 45 },
      resolution: project.resolution,
      cellSize: this.cell,
      buildingCount: this.buildings.length,
      buildings: [...this.buildings],
      canUndo: false,
      canRedo: false,
      waterLevel: project.waterLevel,
      waterEnabled: project.waterEnabled,
      showContours: project.showContours,
      heightMin: stats.min,
      heightMax: stats.max,
      contourInterval: interval,
      contourLevels: Array.from({ length: 6 }, (_, i) => stats.min + (i + 0.5) * interval),
      strataBoundaries: [...project.strataBoundaries],
      strataColors: [...STRATA_COLORS],
      strataNames: [...STRATA_NAMES],
      sections: { ...project.sections },
      saveStatus: 'idle',
      savedAt: project.savedAt ?? null,
      stats: {
        vertices: (this.resolution + 1) ** 2,
        triangles: this.resolution * this.resolution * 2,
        instances: this.buildings.length
      }
    };
  }

  private initThree(): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'sandbox-canvas';
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x101820, 48, 92);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 180);
    this.camera.position.set(17, 14.5, 19);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -0.45, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 62;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.mouseButtons = {
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
  }

  private initSceneObjects(project: ProjectData): void {
    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x6b513b, 1.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.set(13, 22, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 55;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8ec5ff, 0.55);
    fill.position.set(-12, 8, -10);
    this.scene.add(fill);

    this.terrainUniforms = {
      uHeightMin: { value: this.state.heightMin },
      uHeightMax: { value: this.state.heightMax },
      uShowContours: { value: project.showContours ? 1 : 0 },
      uContourLevels: { value: [...this.state.contourLevels] }
    };
    const terrainGeometry = createTerrainGeometry(this.resolution, this.heights);
    const terrainMaterial = createTerrainMaterial(this.terrainUniforms);
    terrainMaterial.clippingPlanes = [this.xPlane, this.yPlane, this.zPlane];
    terrainMaterial.clipShadows = true;
    this.terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f9ed8,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: [this.xPlane, this.yPlane, this.zPlane]
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1), waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = project.waterLevel;
    this.water.visible = project.waterEnabled;
    this.water.renderOrder = 3;
    this.scene.add(this.water);

    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a4030,
      roughness: 0.82,
      metalness: 0.02,
      clippingPlanes: [this.xPlane, this.yPlane, this.zPlane]
    });
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(WORLD_SIZE + 1.3, 0.62, WORLD_SIZE + 1.3), pedestalMaterial);
    pedestal.position.y = BASE_Y - 0.34;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.ShadowMaterial({ opacity: 0.24 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = BASE_Y - 0.67;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.04,
      clippingPlanes: [this.xPlane, this.yPlane, this.zPlane]
    });
    this.buildingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), buildingMaterial, MAX_BUILDINGS);
    buildingMaterial.clipShadows = true;
    this.buildingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildingMesh.count = 0;
    this.buildingMesh.castShadow = true;
    this.buildingMesh.receiveShadow = true;
    this.buildingMesh.frustumCulled = false;
    this.scene.add(this.buildingMesh);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 80), ringMaterial);
    this.brushRing.rotation.x = -Math.PI / 2;
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 8;
    this.scene.add(this.brushRing);

    this.initSectionMeshes();
  }

  private initSectionMeshes(): void {
    const edgeMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
      clippingPlanes: [this.xPlane, this.yPlane, this.zPlane]
    });
    const cutMaterialX = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
      clippingPlanes: [this.yPlane, this.zPlane],
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const cutMaterialZ = cutMaterialX.clone();
    cutMaterialZ.clippingPlanes = [this.xPlane, this.yPlane];

    const half = WORLD_SIZE / 2;
    const edgeDefinitions: Array<RibbonEntry> = [
      { axis: 'x', fixed: -half, mesh: new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial) },
      { axis: 'x', fixed: half, mesh: new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial) },
      { axis: 'z', fixed: -half, mesh: new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial) },
      { axis: 'z', fixed: half, mesh: new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial) }
    ];
    for (const entry of edgeDefinitions) {
      entry.mesh.receiveShadow = true;
      this.edgeRibbons.push(entry);
      this.scene.add(entry.mesh);
    }

    this.cutRibbonX = new THREE.Mesh(new THREE.BufferGeometry(), cutMaterialX);
    this.cutRibbonZ = new THREE.Mesh(new THREE.BufferGeometry(), cutMaterialZ);
    this.cutRibbonX.receiveShadow = true;
    this.cutRibbonZ.receiveShadow = true;
    this.scene.add(this.cutRibbonX, this.cutRibbonZ);

    this.yCapMaterial = new THREE.MeshStandardMaterial({
      color: strataColorAtY(this.state.sections.y, this.state.strataBoundaries),
      roughness: 1,
      side: THREE.DoubleSide,
      clippingPlanes: [this.xPlane, this.zPlane],
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.yCap = new THREE.Mesh(new THREE.BufferGeometry(), this.yCapMaterial);
    this.yCap.receiveShadow = true;
    this.scene.add(this.yCap);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
  }

  private handleContextMenu = (event: Event): void => event.preventDefault();

  private renderFrame = (): void => {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private updatePointerNdc(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickTerrain(event: PointerEvent): THREE.Intersection | null {
    this.updatePointerNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain, false);
    return hits[0] ?? null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const hit = this.pickTerrain(event);
    if (!hit) return;
    event.preventDefault();
    this.controls.enabled = false;
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch { /* pointer capture is optional */ }

    if (this.state.tool === 'building') {
      this.addBuildingAt(hit.point.x, hit.point.z);
      return;
    }

    this.strokeBefore = this.captureSnapshot();
    this.strokeActive = true;
    this.lastStamp = { x: hit.point.x, z: hit.point.z };
    this.flattenTarget = this.sampleHeight(hit.point.x, hit.point.z);
    this.applyStamp(hit.point.x, hit.point.z);
    this.updateBrushRing(hit.point.x, hit.point.z);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.state.tool !== 'sculpt' && !this.strokeActive) {
      this.brushRing.visible = false;
      return;
    }

    const hit = this.pickTerrain(event);
    let x: number;
    let z: number;
    if (hit) {
      x = hit.point.x;
      z = hit.point.z;
    } else if (this.strokeActive) {
      const fallback = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.flattenTarget);
      if (!this.raycaster.ray.intersectPlane(plane, fallback)) return;
      x = clamp(fallback.x, -WORLD_SIZE / 2, WORLD_SIZE / 2);
      z = clamp(fallback.z, -WORLD_SIZE / 2, WORLD_SIZE / 2);
    } else {
      this.brushRing.visible = false;
      return;
    }

    if (this.strokeActive && this.lastStamp) {
      const dx = x - this.lastStamp.x;
      const dz = z - this.lastStamp.z;
      const distance = Math.hypot(dx, dz);
      const spacing = Math.max(this.cell * 1.4, this.state.brush.radius * 0.22);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        this.applyStamp(this.lastStamp.x + dx * t, this.lastStamp.z + dz * t);
      }
      this.lastStamp = { x, z };
    }
    this.updateBrushRing(x, z);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      try { this.renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    }
    this.controls.enabled = true;
    if (!this.strokeActive || !this.strokeBefore) return;
    this.strokeActive = false;
    this.lastStamp = null;

    const position = this.terrain.geometry.attributes.position as THREE.BufferAttribute;
    const normal = this.terrain.geometry.attributes.normal as THREE.BufferAttribute;
    for (let j = 0; j <= this.resolution; j++) {
      for (let i = 0; i <= this.resolution; i++) {
        const id = j * (this.resolution + 1) + i;
        position.array[id * 3 + 1] = this.heights[id];
      }
    }
    computeNormalRegion(this.heights, this.resolution, 0, this.resolution, 0, this.resolution, normal.array as Float32Array);
    uploadWholeAttribute(position);
    uploadWholeAttribute(normal);

    this.terrain.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 34);
    this.refreshHeightStats(true);
    this.rebuildAllBuildingMatrices();
    this.rebuildRibbons();
    this.rebuildYCap();

    const after = this.captureSnapshot();
    this.pushHistory({ label: '笔刷雕刻', before: this.strokeBefore, after });
    this.strokeBefore = null;
    this.scheduleSave();
  };

  private handlePointerCancel = (): void => {
    this.strokeActive = false;
    this.strokeBefore = null;
    this.lastStamp = null;
    this.controls.enabled = true;
  };

  private handlePointerLeave = (): void => {
    if (!this.strokeActive) this.brushRing.visible = false;
  };

  private updateBrushRing(x: number, z: number): void {
    if (this.state.tool !== 'sculpt') {
      this.brushRing.visible = false;
      return;
    }
    const y = this.sampleHeight(x, z) + 0.075;
    this.brushRing.visible = true;
    this.brushRing.position.set(x, y, z);
    this.brushRing.scale.setScalar(this.state.brush.radius);
  }

  private applyStamp(centerX: number, centerZ: number): void {
    const { radius, strength, type } = this.state.brush;
    const power = strength / 100;
    const row = this.resolution + 1;
    const gx = centerX / this.cell + this.resolution / 2;
    const gz = centerZ / this.cell + this.resolution / 2;
    const radiusCells = radius / this.cell;
    const i0 = Math.max(0, Math.floor(gx - radiusCells) - 1);
    const i1 = Math.min(this.resolution, Math.ceil(gx + radiusCells) + 1);
    const j0 = Math.max(0, Math.floor(gz - radiusCells) - 1);
    const j1 = Math.min(this.resolution, Math.ceil(gz + radiusCells) + 1);
    const affected: Array<[number, number]> = [];

    if (type === 'smooth') {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const id = j * row + i;
          const dist = Math.hypot((i - gx) * this.cell, (j - gz) * this.cell) / radius;
          if (dist > 1) continue;
          let sum = 0;
          let count = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const ni = clamp(i + di, 0, this.resolution);
              const nj = clamp(j + dj, 0, this.resolution);
              sum += this.heights[nj * row + ni];
              count++;
            }
          }
          this.scratch[id] = sum / count;
          affected.push([i, j]);
        }
      }
    }

    for (const [i, j] of affected.length ? affected : this.enumerateBox(i0, i1, j0, j1)) {
      const id = j * row + i;
      const dist = Math.hypot((i - gx) * this.cell, (j - gz) * this.cell) / radius;
      if (dist > 1) continue;
      const falloff = 0.5 + 0.5 * Math.cos(Math.PI * dist);
      if (type === 'raise') {
        this.heights[id] = clamp(this.heights[id] + 0.17 * power * falloff, MIN_HEIGHT, MAX_HEIGHT);
      } else if (type === 'lower') {
        this.heights[id] = clamp(this.heights[id] - 0.17 * power * falloff, MIN_HEIGHT, MAX_HEIGHT);
      } else if (type === 'flatten') {
        const blend = Math.min(0.85, 0.28 * power * falloff);
        this.heights[id] = clamp(this.heights[id] + (this.flattenTarget - this.heights[id]) * blend, MIN_HEIGHT, MAX_HEIGHT);
      } else if (type === 'smooth') {
        const blend = Math.min(0.9, 0.48 * power * falloff);
        this.heights[id] += (this.scratch[id] - this.heights[id]) * blend;
      }
    }

    const position = this.terrain.geometry.attributes.position as THREE.BufferAttribute;
    const posArray = position.array as Float32Array;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const id = j * row + i;
        posArray[id * 3 + 1] = this.heights[id];
      }
    }
    uploadRowRanges(position, this.resolution, i0, i1, j0, j1);

    const ni0 = Math.max(0, i0 - 1);
    const ni1 = Math.min(this.resolution, i1 + 1);
    const nj0 = Math.max(0, j0 - 1);
    const nj1 = Math.min(this.resolution, j1 + 1);
    const normal = this.terrain.geometry.attributes.normal as THREE.BufferAttribute;
    computeNormalRegion(this.heights, this.resolution, ni0, ni1, nj0, nj1, normal.array as Float32Array);
    uploadRowRanges(normal, this.resolution, ni0, ni1, nj0, nj1);
    this.updateBuildingsInWorldBox(
      (i0 - this.resolution / 2 - 1) * this.cell,
      (i1 - this.resolution / 2 + 1) * this.cell,
      (j0 - this.resolution / 2 - 1) * this.cell,
      (j1 - this.resolution / 2 + 1) * this.cell
    );
  }

  private enumerateBox(i0: number, i1: number, j0: number, j1: number): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) result.push([i, j]);
    return result;
  }

  private sampleHeight(x: number, z: number): number {
    return sampleHeightWorld(this.heights, this.resolution, x, z);
  }

  private captureSnapshot(): { heights: Float32Array; buildings: Building[] } {
    return {
      heights: this.heights.slice(),
      buildings: this.buildings.map((b) => ({ ...b }))
    };
  }

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistoryState();
  }

  private emitHistoryState(): void {
    this.emit({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.restoreSnapshot(entry.before);
    this.scheduleSave();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.restoreSnapshot(entry.after);
    this.scheduleSave();
  }

  private restoreSnapshot(snapshot: { heights: Float32Array; buildings: Building[] }): void {
    if (snapshot.heights.length !== this.heights.length) return;
    this.heights.set(snapshot.heights);
    this.buildings = snapshot.buildings.map((b) => ({ ...b }));

    const geometry = this.terrain.geometry;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    const posArray = position.array as Float32Array;
    for (let id = 0; id < this.heights.length; id++) posArray[id * 3 + 1] = this.heights[id];
    computeNormalRegion(this.heights, this.resolution, 0, this.resolution, 0, this.resolution, normal.array as Float32Array);
    uploadWholeAttribute(position);
    uploadWholeAttribute(normal);
    this.refreshHeightStats(false);
    this.rebuildBuildings();
    this.rebuildRibbons();
    this.rebuildYCap();
    this.emit({
      buildingCount: this.buildings.length,
      buildings: [...this.buildings],
      ...this.historyFlags()
    });
  }

  private historyFlags(): { canUndo: boolean; canRedo: boolean } {
    return { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  private addBuildingAt(x: number, z: number): void {
    const before = this.captureSnapshot();
    const half = WORLD_SIZE / 2 - 0.8;
    const building: Building = {
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      x: clamp(x, -half, half),
      z: clamp(z, -half, half),
      width: 0.55 + Math.random() * 0.85,
      depth: 0.55 + Math.random() * 1.05,
      height: 0.9 + Math.random() * 3.4,
      rotation: Math.random() < 0.25 ? Math.round(Math.random() * 3) * Math.PI / 2 : 0,
      color: BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)]
    };
    this.buildings = [...this.buildings, building].slice(-MAX_BUILDINGS);
    this.rebuildBuildings();
    this.pushHistory({ label: '放置建筑', before, after: this.captureSnapshot() });
    this.emitBuildings();
    this.scheduleSave();
  }

  generateCluster(countInput: number): void {
    const count = Math.round(clamp(countInput, 20, 40));
    const before = this.captureSnapshot();
    const next: Building[] = [];
    const cols = Math.ceil(Math.sqrt(count * 1.25));
    const rows = Math.ceil(count / cols);
    const spacingX = Math.min(1.85, 11.5 / Math.max(1, cols - 1));
    const spacingZ = Math.min(1.75, 10.5 / Math.max(1, rows - 1));
    const startX = -((cols - 1) * spacingX) / 2;
    const startZ = -((rows - 1) * spacingZ) / 2;

    for (let n = 0; n < count; n++) {
      const c = n % cols;
      const r = Math.floor(n / cols);
      const x = clamp(startX + c * spacingX + (Math.random() - 0.5) * 0.42, -10.8, 10.8);
      const z = clamp(startZ + r * spacingZ + (Math.random() - 0.5) * 0.42, -9.8, 9.8);
      next.push({
        id: `cluster_${n}_${Math.random().toString(36).slice(2, 8)}`,
        x,
        z,
        width: 0.55 + Math.random() * 0.72,
        depth: 0.58 + Math.random() * 0.82,
        height: 0.85 + Math.random() * 3.1,
        rotation: Math.random() < 0.18 ? Math.PI / 2 : 0,
        color: BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)]
      });
    }

    this.buildings = next;
    this.rebuildBuildings();
    this.pushHistory({ label: '生成建筑群', before, after: this.captureSnapshot() });
    this.emitBuildings();
    this.scheduleSave();
  }

  addStressBuildings(count = 1000): void {
    const before = this.captureSnapshot();
    const next = [...this.buildings];
    const half = WORLD_SIZE / 2 - 0.5;
    for (let i = 0; i < count && next.length < MAX_BUILDINGS; i++) {
      next.push({
        id: `stress_${i}_${Math.random().toString(36).slice(2, 8)}`,
        x: (Math.random() * 2 - 1) * half,
        z: (Math.random() * 2 - 1) * half,
        width: 0.25 + Math.random() * 0.45,
        depth: 0.25 + Math.random() * 0.5,
        height: 0.35 + Math.random() * 1.8,
        rotation: Math.random() * Math.PI,
        color: BUILDING_COLORS[i % BUILDING_COLORS.length]
      });
    }
    this.buildings = next;
    this.rebuildBuildings();
    this.pushHistory({ label: '性能压测实例', before, after: this.captureSnapshot() });
    this.emitBuildings();
    this.scheduleSave();
  }

  deleteBuilding(id: string): void {
    const before = this.captureSnapshot();
    this.buildings = this.buildings.filter((b) => b.id !== id);
    this.rebuildBuildings();
    this.pushHistory({ label: '删除建筑', before, after: this.captureSnapshot() });
    this.emitBuildings();
    this.scheduleSave();
  }

  clearBuildings(): void {
    if (!this.buildings.length) return;
    const before = this.captureSnapshot();
    this.buildings = [];
    this.rebuildBuildings();
    this.pushHistory({ label: '清空建筑', before, after: this.captureSnapshot() });
    this.emitBuildings();
    this.scheduleSave();
  }

  private emitBuildings(): void {
    this.emit({
      buildingCount: this.buildings.length,
      buildings: [...this.buildings],
      stats: { ...this.state.stats, instances: this.buildings.length }
    });
  }

  private composeBuildingMatrix(building: Building): void {
    const y = this.sampleHeight(building.x, building.z);
    this.tmpEuler.set(0, building.rotation, 0);
    this.tmpQuaternion.setFromEuler(this.tmpEuler);
    this.tmpPosition.set(building.x, y + 0.015, building.z);
    this.tmpScale.set(building.width, building.height, building.depth);
    this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
  }

  private rebuildBuildings(): void {
    this.buildingMesh.count = this.buildings.length;
    this.buildings.forEach((building, index) => {
      this.composeBuildingMatrix(building);
      this.buildingMesh.setMatrixAt(index, this.tmpMatrix);
      this.buildingMesh.setColorAt(index, new THREE.Color(building.color));
    });
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
  }

  private rebuildAllBuildingMatrices(): void {
    this.buildings.forEach((_, index) => {
      const building = this.buildings[index];
      this.composeBuildingMatrix(building);
      this.buildingMesh.setMatrixAt(index, this.tmpMatrix);
    });
    this.buildingMesh.instanceMatrix.needsUpdate = true;
  }

  private updateBuildingsInWorldBox(minX: number, maxX: number, minZ: number, maxZ: number): void {
    let changed = false;
    this.buildings.forEach((building, index) => {
      const pad = Math.max(building.width, building.depth);
      if (
        building.x + pad < minX || building.x - pad > maxX ||
        building.z + pad < minZ || building.z - pad > maxZ
      ) return;
      this.composeBuildingMatrix(building);
      this.buildingMesh.setMatrixAt(index, this.tmpMatrix);
      changed = true;
    });
    if (changed) this.buildingMesh.instanceMatrix.needsUpdate = true;
  }

  private refreshHeightStats(notify: boolean): void {
    const { min, max } = heightStats(this.heights);
    const interval = Math.max(0.05, (max - min) / 6);
    const levels = Array.from({ length: 6 }, (_, i) => min + (i + 0.5) * interval);
    this.terrainUniforms.uHeightMin.value = min;
    this.terrainUniforms.uHeightMax.value = max;
    this.terrainUniforms.uContourLevels.value = levels;
    if (notify) this.emit({ heightMin: min, heightMax: max, contourInterval: interval, contourLevels: levels });
  }

  private replaceGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  private rebuildRibbons(): void {
    for (const entry of this.edgeRibbons) {
      this.replaceGeometry(
        entry.mesh,
        buildRibbonGeometry(entry.axis, entry.fixed, this.heights, this.resolution, this.state.strataBoundaries)
      );
    }
    this.replaceGeometry(
      this.cutRibbonX,
      buildRibbonGeometry('x', this.state.sections.x, this.heights, this.resolution, this.state.strataBoundaries)
    );
    this.replaceGeometry(
      this.cutRibbonZ,
      buildRibbonGeometry('z', this.state.sections.z, this.heights, this.resolution, this.state.strataBoundaries)
    );
  }

  private rebuildYCap(): void {
    this.replaceGeometry(this.yCap, buildYCapGeometry(this.state.sections.y, this.heights, this.resolution));
    this.yCapMaterial.color.set(strataColorAtY(this.state.sections.y, this.state.strataBoundaries));
  }

  private updateClipPlanes(): void {
    const s = this.state.sections;
    this.xPlane.normal.set(-1, 0, 0);
    this.zPlane.normal.set(0, 0, -1);
    this.yPlane.normal.set(0, -1, 0);
    this.xPlane.constant = s.xEnabled ? s.x : 10000;
    this.zPlane.constant = s.zEnabled ? s.z : 10000;
    this.yPlane.constant = s.yEnabled ? s.y : 10000;
    this.cutRibbonX.visible = s.xEnabled;
    this.cutRibbonZ.visible = s.zEnabled;
    this.yCap.visible = s.yEnabled;
  }

  setTool(tool: UiState['tool']): void {
    this.brushRing.visible = false;
    this.emit({ tool });
  }

  setBrush(patch: Partial<BrushSettings>): void {
    this.emit({ brush: { ...this.state.brush, ...patch } });
  }

  setName(name: string): void {
    this.emit({ name });
    this.scheduleSave();
  }

  setWaterLevel(level: number): void {
    const waterLevel = clamp(level, -3, 8);
    this.water.position.y = waterLevel;
    this.emit({ waterLevel });
    this.scheduleSave();
  }

  setWaterEnabled(enabled: boolean): void {
    this.water.visible = enabled;
    this.emit({ waterEnabled: enabled });
    this.scheduleSave();
  }

  setContoursEnabled(enabled: boolean): void {
    this.terrainUniforms.uShowContours.value = enabled ? 1 : 0;
    this.emit({ showContours: enabled });
    this.scheduleSave();
  }

  setSection(patch: Partial<SectionSettings>): void {
    const previous = this.state.sections;
    const next = { ...previous, ...patch };
    this.emit({ sections: next });
    this.updateClipPlanes();
    if (patch.x !== undefined && patch.x !== previous.x) {
      this.replaceGeometry(this.cutRibbonX, buildRibbonGeometry('x', next.x, this.heights, this.resolution, this.state.strataBoundaries));
    }
    if (patch.z !== undefined && patch.z !== previous.z) {
      this.replaceGeometry(this.cutRibbonZ, buildRibbonGeometry('z', next.z, this.heights, this.resolution, this.state.strataBoundaries));
    }
    if (patch.y !== undefined && patch.y !== previous.y) this.rebuildYCap();
    this.scheduleSave();
  }

  setStrataBoundary(index: number, value: number): void {
    const next = [...this.state.strataBoundaries];
    const lower = index === 0 ? BASE_Y + 0.35 : next[index - 1] + 0.32;
    const upper = index === next.length - 1 ? 3.8 : next[index + 1] - 0.32;
    next[index] = clamp(value, lower, upper);
    this.emit({ strataBoundaries: next });
    this.rebuildRibbons();
    this.rebuildYCap();
    this.scheduleSave();
  }

  async setResolution(nextResolution: number): Promise<void> {
    if (nextResolution === this.resolution) return;
    const oldRes = this.resolution;
    const resampled = resampleHeightField(this.heights, oldRes, nextResolution);
    this.resolution = nextResolution;
    this.cell = WORLD_SIZE / nextResolution;
    this.heights = resampled;
    this.scratch = new Float32Array(this.heights.length);
    this.terrain.geometry.dispose();
    this.terrain.geometry = createTerrainGeometry(nextResolution, this.heights);
    this.undoStack = [];
    this.redoStack = [];
    this.refreshHeightStats(false);
    this.rebuildBuildings();
    this.rebuildRibbons();
    this.rebuildYCap();
    this.emit({
      resolution: nextResolution,
      cellSize: this.cell,
      stats: {
        vertices: (nextResolution + 1) ** 2,
        triangles: nextResolution * nextResolution * 2,
        instances: this.buildings.length
      },
      ...this.historyFlags()
    });
    this.scheduleSave();
  }

  serializeProject(): ProjectData {
    return {
      format: 'micro-sandbox-terrain',
      version: 1,
      name: this.state.name,
      savedAt: new Date().toISOString(),
      resolution: this.resolution,
      cellSize: this.cell,
      heightField: Array.from(this.heights, (v) => Math.round(v * 1000) / 1000),
      buildings: this.buildings.map((b) => ({ ...b })),
      waterLevel: this.state.waterLevel,
      waterEnabled: this.state.waterEnabled,
      showContours: this.state.showContours,
      strataBoundaries: [...this.state.strataBoundaries],
      sections: { ...this.state.sections }
    };
  }

  scheduleSave(delay = 650): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), delay);
  }

  saveNow(): boolean {
    if (this.disposed) return false;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.emit({ saveStatus: 'saving' });
    const project = this.serializeProject();
    const ok = saveStoredProject(project);
    this.emit({
      saveStatus: ok ? 'saved' : 'error',
      savedAt: project.savedAt ?? new Date().toISOString()
    });
    return ok;
  }

  importProject(project: ProjectData): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.resolution = project.resolution;
    this.cell = WORLD_SIZE / project.resolution;
    this.heights = Float32Array.from(project.heightField);
    this.scratch = new Float32Array(this.heights.length);
    this.buildings = project.buildings.map((b) => ({ ...b }));
    this.undoStack = [];
    this.redoStack = [];

    this.terrain.geometry.dispose();
    this.terrain.geometry = createTerrainGeometry(this.resolution, this.heights);
    this.terrainUniforms.uShowContours.value = project.showContours ? 1 : 0;
    this.water.position.y = project.waterLevel;
    this.water.visible = project.waterEnabled;

    const retainedTool = this.state.tool;
    const retainedBrush = this.state.brush;
    this.state = this.buildUiState(project);
    this.state.tool = retainedTool;
    this.state.brush = retainedBrush;

    this.refreshHeightStats(false);
    this.updateClipPlanes();
    this.rebuildBuildings();
    this.rebuildRibbons();
    this.rebuildYCap();
    this.resetCamera();
    this.emit();
    this.saveNow();
  }

  resetSampleTerrain(): void {
    this.importProject(createDefaultProject(`${this.state.name || '未命名沙盘'} · 重置`));
  }

  resetCamera(): void {
    this.camera.position.set(17, 14.5, 19);
    this.controls.target.set(0, -0.45, 0);
    this.controls.update();
  }

  dispose(): void {
    this.saveNow();
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.resizeObserver?.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);

    this.controls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
    this.listeners.clear();
  }
}
