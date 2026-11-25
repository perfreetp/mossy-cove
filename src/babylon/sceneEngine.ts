import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import type { IPointerEvent } from '@babylonjs/core/Events/deviceInputEvents.js';
import { TerrainMesh } from './terrainMesh';
import { CloudLayer } from './cloudLayer';
import { LIGHTING_PRESETS, type LightingPreset, type LightingPresetId } from '../lib/lighting';
import { TerrainModel, type BrushPatch } from '../lib/noise';
import {
  clearanceFromHeight,
  resolveCloudSeparation,
  type CloudBlob
} from '../lib/clouds';
import { clamp } from '../lib/mathUtils';
import { createBrushCursorTexture } from '../lib/textures';

export type InteractionMode = 'camera' | 'brush' | 'cloud';

export interface EngineCallbacks {
  onBrushCommit(before: Float32Array, after: Float32Array): void;
  onCloudDragCommit(id: string, before: { x: number; z: number }, after: { x: number; z: number }): void;
  /** 拖拽过程中的实时位置同步（引擎直接改了 blob，这里通知 store 对齐，不写历史）。 */
  onCloudDragMove(id: string, x: number, z: number): void;
  onSelectionChange(id: string | null): void;
}

interface BrushRuntime {
  radius: number;
  strength: number;
  mode: 'raise' | 'lower';
}

interface Tween {
  t: number;
  duration: number;
  fromSun: Vector3;
  toSun: Vector3;
  fromColors: Record<string, Color3>;
  toColors: Record<string, Color3>;
  fromFog: Color3;
  toFog: Color3;
  fromFogDensity: number;
  toFogDensity: number;
  fromSunIntensity: number;
  fromHemiIntensity: number;
  preset: LightingPreset;
}

export class SceneEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly terrainModel: TerrainModel;
  private readonly terrainMesh: TerrainMesh;
  private readonly cloudLayer: CloudLayer;
  private readonly callbacks: EngineCallbacks;

  private camera: ArcRotateCamera;
  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private skyTexture: DynamicTexture;
  private brushCursor: Mesh;
  private brush: BrushRuntime = { radius: 22, strength: 6, mode: 'raise' };
  private mode: InteractionMode = 'camera';
  private blobs: CloudBlob[] = [];
  private cling = 0.35;
  private selectedId: string | null = null;
  private tween: Tween | null = null;
  private currentPreset: LightingPreset = LIGHTING_PRESETS.noon;

  // 交互临时状态
  private brushing = false;
  private brushSnapshot: Float32Array | null = null;
  private draggingCloud: CloudBlob | null = null;
  private dragBefore: { x: number; z: number } | null = null;
  private dragMoved = false;
  private pointerDownX = 0;
  private pointerDownY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    terrainModel: TerrainModel,
    callbacks: EngineCallbacks
  ) {
    this.canvas = canvas;
    this.terrainModel = terrainModel;
    this.callbacks = callbacks;

    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false
    });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color3.FromArray(LIGHTING_PRESETS.noon.fogColor).toColor4(1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    // 初始雾浓度会在 applyPresetInstant 中按预设覆盖
    this.scene.fogDensity = LIGHTING_PRESETS.noon.fogDensity;
    this.scene.fogColor = Color3.FromArray(LIGHTING_PRESETS.noon.fogColor);
    // 中性场景环境光，与材质 ambientColor 共同保证顶点色不被暖光完全覆盖
    this.scene.ambientColor = new Color3(0.35, 0.35, 0.38);

    this.camera = new ArcRotateCamera('camera', -Math.PI / 2.3, 0.92, 260, new Vector3(0, 16, 0), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 80;
    this.camera.upperRadiusLimit = 480;
    this.camera.upperBetaLimit = 1.35;
    this.camera.lowerBetaLimit = 0.25;
    this.camera.wheelDeltaPercentage = 0.012;
    this.camera.pinchDeltaPercentage = 0.012;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 1400;

    this.sun = new DirectionalLight('sun', new Vector3(0.5, -1, 0.3), this.scene);
    this.sun.position = new Vector3(-120, 180, -80);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);

    this.skyTexture = this.buildSky(LIGHTING_PRESETS.noon);
    this.terrainMesh = new TerrainMesh(this.scene, terrainModel);
    const terrainMat = new StandardMaterial('mat-terrain', this.scene);
    terrainMat.specularColor = new Color3(0.04, 0.04, 0.04);
    // 中性环境底色：晨昏暖光会把顶点色乘偏，保留一部分原色让草甸/岩石可辨认
    terrainMat.ambientColor = new Color3(0.55, 0.55, 0.55);
    this.terrainMesh.mesh.material = terrainMat;

    this.cloudLayer = new CloudLayer(this.scene, LIGHTING_PRESETS.noon);
    this.cloudLayer.blobProvider = (id) => this.blobs.find((b) => b.id === id);

    this.brushCursor = this.buildBrushCursor();

    this.applyPresetInstant(LIGHTING_PRESETS.noon);
    this.bindPointer();
    this.scene.onBeforeRenderObservable.add(() => this.tick());
    this.engine.runRenderLoop(() => this.scene.render());

    const resize = () => this.engine.resize();
    window.addEventListener('resize', resize);
    this.scene.onDisposeObservable.add(() => window.removeEventListener('resize', resize));
  }

  // ------------------------------------------------------------- 装配辅助

  private buildSky(preset: LightingPreset): DynamicTexture {
    const sky = MeshBuilder.CreateSphere(
      'sky-dome',
      { diameter: 980, sideOrientation: Mesh.BACKSIDE },
      this.scene
    );
    const mat = new StandardMaterial('mat-sky', this.scene);
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    const tex = new DynamicTexture('sky-gradient', { width: 4, height: 256 }, this.scene, false);
    this.paintSky(tex, preset);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.specularColor = new Color3(0, 0, 0);
    sky.material = mat;
    sky.isPickable = false;
    sky.infiniteDistance = true;
    return tex;
  }

  private paintSky(tex: DynamicTexture, preset: LightingPreset): void {
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 256, 0, 0);
    const horizon = preset.skyHorizon;
    const zenith = preset.skyZenith;
    grad.addColorStop(0, `rgb(${zenith.map((c) => Math.round(c * 255)).join(',')})`);
    grad.addColorStop(0.55, `rgb(${horizon.map((c) => Math.round(c * 255)).join(',')})`);
    grad.addColorStop(1, `rgb(${horizon.map((c) => Math.round(c * 255)).join(',')})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    tex.update();
  }

  private buildBrushCursor(): Mesh {
    const tex = createBrushCursorTexture(this.scene);
    const mat = new StandardMaterial('mat-brush-cursor', this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane(
      'brush-cursor',
      { size: 1, sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    plane.material = mat;
    plane.rotation.x = Math.PI / 2;
    plane.isPickable = false;
    plane.position.y = 1;
    plane.setEnabled(false);
    return plane;
  }

  private sunDirection(preset: LightingPreset): Vector3 {
    const el = preset.elevation;
    const az = preset.azimuth;
    return new Vector3(Math.cos(el) * Math.cos(az), -Math.sin(el), Math.cos(el) * Math.sin(az));
  }

  private applyPresetInstant(preset: LightingPreset): void {
    this.currentPreset = preset;
    const dir = this.sunDirection(preset);
    this.sun.direction.copyFrom(dir);
    this.sun.position.copyFrom(dir.scale(-220));
    this.sun.diffuse = Color3.FromArray(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemi.diffuse = Color3.FromArray(preset.skyColor);
    this.hemi.groundColor = Color3.FromArray(preset.groundColor);
    this.hemi.intensity = preset.ambientIntensity;
    const fog = Color3.FromArray(preset.fogColor);
    this.scene.fogColor = fog;
    this.scene.fogDensity = preset.fogDensity;
    this.scene.clearColor = fog.toColor4(1);
    this.paintSky(this.skyTexture, preset);
    this.cloudLayer.applyLighting(preset);
  }

  // ------------------------------------------------------------- 对外 API

  setMode(mode: InteractionMode): void {
    this.mode = mode;
    if (mode === 'brush') {
      this.camera.detachControl();
      this.brushCursor.setEnabled(true);
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.camera.attachControl(this.canvas, true);
      this.brushCursor.setEnabled(false);
      this.canvas.style.cursor = mode === 'cloud' ? 'grab' : 'default';
    }
    if (mode !== 'brush') this.brushCursor.setEnabled(false);
  }

  setBrushSettings(radius: number, strength: number, brushMode: 'raise' | 'lower'): void {
    this.brush = { radius, strength, mode: brushMode };
  }

  setCling(cling: number): void {
    this.cling = cling;
    this.syncAllCloudHeights();
  }

  setClouds(blobs: CloudBlob[], cling: number): void {
    this.blobs = blobs;
    this.cling = cling;
    const incoming = new Set(blobs.map((b) => b.id));
    this.cloudLayer.retainOnly(incoming);
    for (const blob of blobs) {
      this.cloudLayer.upsertCloud(blob, this.terrainModel.heightAt(blob.x, blob.z));
    }
    this.syncAllCloudHeights();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.cloudLayer.setSelected(id);
  }

  terrainRebuilt(): void {
    this.terrainMesh.rebuildAll();
    this.syncAllCloudHeights();
  }

  terrainBrushRefreshed(patch: BrushPatch): void {
    this.terrainMesh.refreshFromBrush(patch.bounds);
    this.syncAllCloudHeights();
  }

  setLightingInitial(presetId: LightingPresetId): void {
    this.applyPresetInstant(LIGHTING_PRESETS[presetId]);
  }

  setLighting(presetId: LightingPresetId): void {
    const preset = LIGHTING_PRESETS[presetId];
    this.tween = {
      t: 0,
      duration: 0.6,
      fromSun: this.sun.direction.clone(),
      toSun: this.sunDirection(preset),
      fromColors: {
        sun: this.sun.diffuse.clone(),
        hemi: this.hemi.diffuse.clone(),
        ground: this.hemi.groundColor.clone()
      },
      toColors: {
        sun: Color3.FromArray(preset.sunColor),
        hemi: Color3.FromArray(preset.skyColor),
        ground: Color3.FromArray(preset.groundColor)
      },
      fromFog: this.scene.fogColor.clone(),
      toFog: Color3.FromArray(preset.fogColor),
      fromFogDensity: this.scene.fogDensity,
      toFogDensity: preset.fogDensity,
      fromSunIntensity: this.sun.intensity,
      fromHemiIntensity: this.hemi.intensity,
      preset
    };
    // 云团明暗与投影方向立即切到目标，随平行光补间自然收敛
    this.cloudLayer.applyLighting(preset);
  }

  get selectedCloudId(): string | null {
    return this.selectedId;
  }

  get activePreset(): LightingPreset {
    return this.currentPreset;
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------- 内部交互

  private syncAllCloudHeights(): void {
    for (const blob of this.blobs) {
      blob.clearance = clearanceFromHeight(blob.height, this.cling);
    }
    this.cloudLayer.syncHeights(this.blobs, (x, z) => this.terrainModel.heightAt(x, z));
    this.cloudLayer.setSelected(this.selectedId);
  }

  private pickTerrain(): { x: number; z: number; y: number } | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => m === this.terrainMesh.mesh
    );
    if (pick?.hit && pick.pickedPoint) {
      return { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z };
    }
    return null;
  }

  private bindPointer(): void {
    this.scene.onPointerObservable.add((info) => {
      const evt = info.event as IPointerEvent;
      switch (info.type) {
        case PointerEventTypes.POINTERDOWN:
          this.onPointerDown(evt);
          break;
        case PointerEventTypes.POINTERMOVE:
          this.onPointerMove(evt);
          break;
        case PointerEventTypes.POINTERUP:
          this.onPointerUp(evt);
          break;
      }
    });
  }

  private onPointerDown(evt: IPointerEvent): void {
    this.pointerDownX = evt.clientX;
    this.pointerDownY = evt.clientY;

    if (this.mode === 'brush') {
      const hit = this.pickTerrain();
      if (!hit) return;
      this.brushing = true;
      this.brushSnapshot = Float32Array.from(this.terrainModel.brushMap);
      this.stampBrush(hit.x, hit.z);
      return;
    }

    // 任意模式下：点中云团即可选中并拖拽（锁定云团仅选中不可拖）
    const cloudId = this.cloudLayer.pickCloudId();
    if (cloudId) {
      const blob = this.blobs.find((b) => b.id === cloudId);
      if (!blob || !blob.visible) return;
      this.callbacks.onSelectionChange(cloudId);
      if (!blob.locked) {
        this.draggingCloud = blob;
        this.dragBefore = { x: blob.x, z: blob.z };
        this.dragMoved = false;
        this.camera.detachControl();
        this.canvas.style.cursor = 'grabbing';
      }
    }
  }

  private onPointerMove(evt: IPointerEvent): void {
    if (this.mode === 'brush') {
      const hit = this.pickTerrain();
      if (hit) {
        this.brushCursor.setEnabled(true);
        this.brushCursor.position.set(hit.x, hit.y + 0.7, hit.z);
        this.brushCursor.scaling.set(this.brush.radius * 2, this.brush.radius * 2, 1);
      } else {
        this.brushCursor.setEnabled(false);
      }
      if (this.brushing && hit) this.stampBrush(hit.x, hit.z);
      return;
    }

    if (this.draggingCloud) {
      const hit = this.pickTerrain();
      if (!hit) return;
      const resolved = resolveCloudSeparation(this.blobs, this.draggingCloud.id, hit.x, hit.z);
      const moved =
        Math.abs(resolved.x - this.dragBefore!.x) > 0.01 ||
        Math.abs(resolved.z - this.dragBefore!.z) > 0.01;
      if (moved) this.dragMoved = true;
      this.draggingCloud.x = resolved.x;
      this.draggingCloud.z = resolved.z;
      this.syncAllCloudHeights();
      this.callbacks.onCloudDragMove(this.draggingCloud.id, resolved.x, resolved.z);
      void evt;
    } else if (this.mode === 'cloud') {
      const id = this.cloudLayer.pickCloudId();
      this.canvas.style.cursor = id ? 'grab' : 'default';
    }
  }

  private onPointerUp(evt: IPointerEvent): void {
    if (this.mode === 'brush' && this.brushing) {
      this.brushing = false;
      const after = Float32Array.from(this.terrainModel.brushMap);
      const before = this.brushSnapshot!;
      this.brushSnapshot = null;
      // 无实际变化则不入历史
      if (after.some((v, i) => v !== before[i])) {
        this.callbacks.onBrushCommit(before, after);
      }
      return;
    }

    if (this.draggingCloud) {
      const blob = this.draggingCloud;
      const before = this.dragBefore!;
      this.camera.attachControl(this.canvas, true);
      this.canvas.style.cursor = this.mode === 'cloud' ? 'grab' : 'default';
      if (this.dragMoved) {
        this.callbacks.onCloudDragCommit(
          blob.id,
          before,
          { x: blob.x, z: blob.z }
        );
      }
      this.draggingCloud = null;
      this.dragBefore = null;
      this.dragMoved = false;
      return;
    }

    // 点击空白处取消选中（忽略拖动相机后的松手）
    const dist = Math.hypot(evt.clientX - this.pointerDownX, evt.clientY - this.pointerDownY);
    if (dist < 4 && !this.cloudLayer.pickCloudId()) {
      this.callbacks.onSelectionChange(null);
    }
  }

  private stampBrush(worldX: number, worldZ: number): void {
    const direction = this.brush.mode === 'raise' ? 1 : -1;
    // 单次笔画内按帧强度折算，避免移动越慢堆得越高
    const stepStrength = this.brush.strength * 0.35;
    const patch = this.terrainModel.applyBrush(
      worldX,
      worldZ,
      this.brush.radius,
      stepStrength,
      direction as 1 | -1
    );
    if (patch.indices.length > 0) this.terrainBrushRefreshed(patch);
  }

  private tick(): void {
    if (!this.tween) return;
    const tw = this.tween;
    tw.t += this.engine.getDeltaTime() / 1000 / tw.duration;
    const k = clamp(tw.t, 0, 1);
    const e = k * k * (3 - 2 * k);
    Vector3.LerpToRef(tw.fromSun, tw.toSun, e, this.sun.direction);
    this.sun.position.copyFrom(this.sun.direction.scale(-220));
    Color3.LerpToRef(tw.fromColors.sun, tw.toColors.sun, e, this.sun.diffuse);
    Color3.LerpToRef(tw.fromColors.hemi, tw.toColors.hemi, e, this.hemi.diffuse);
    Color3.LerpToRef(tw.fromColors.ground, tw.toColors.ground, e, this.hemi.groundColor);
    const fog = Color3.Lerp(tw.fromFog, tw.toFog, e);
    this.scene.fogColor = fog;
    this.scene.fogDensity = lerpNum(tw.fromFogDensity, tw.toFogDensity, e);
    this.scene.clearColor = fog.toColor4(1);
    this.sun.intensity = lerpNum(tw.fromSunIntensity, tw.preset.sunIntensity, e);
    this.hemi.intensity = lerpNum(tw.fromHemiIntensity, tw.preset.ambientIntensity, e);
    if (k >= 1) {
      this.currentPreset = tw.preset;
      this.paintSky(this.skyTexture, tw.preset);
      this.tween = null;
    }
  }
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
