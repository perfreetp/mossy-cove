import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { CloudBlob } from '../lib/clouds';
import { RNG } from '../lib/mathUtils';
import { createCloudPuffTexture, createCloudShadowTexture } from '../lib/textures';
import type { LightingPreset } from '../lib/lighting';

/**
 * 云团渲染层：
 * - 每个云团 = 若干始终面向相机的绒球贴片（billboard），密度档决定数量；
 * - 厚度档决定纵向堆叠层数与整体压扁比例；
 * - 云影为地面上的半透明暗色贴片，方位/长度随太阳高度角变化；
 * - 选中态用地面圆环 + 轻微描边表示。
 */

interface CloudVisual {
  blobId: string;
  root: TransformNode;
  puffs: Mesh[];
  shadowAnchor: TransformNode;
  shadow: Mesh;
  selector: Mesh;
  basePuffAlpha: number[];
  structureKey: string;
}

function structureKeyOf(blob: CloudBlob): string {
  return `${blob.density}|${blob.thickness}|${blob.radius.toFixed(2)}`;
}

export class CloudLayer {
  private readonly scene: Scene;
  private readonly visuals = new Map<string, CloudVisual>();
  private readonly puffMaterial: StandardMaterial;
  private readonly shadowMaterial: StandardMaterial;
  private preset: LightingPreset;
  private shadowDirection = { x: 0.4, z: 0.3 };
  private sunElevation = 0.6;

  constructor(scene: Scene, preset: LightingPreset) {
    this.scene = scene;
    this.preset = preset;
    const puffTex = createCloudPuffTexture(scene);
    const shadowTex = createCloudShadowTexture(scene);

    this.puffMaterial = new StandardMaterial('mat-cloud-puff', scene);
    this.puffMaterial.diffuseTexture = puffTex;
    this.puffMaterial.emissiveTexture = puffTex;
    this.puffMaterial.opacityTexture = puffTex;
    this.puffMaterial.backFaceCulling = false;
    this.puffMaterial.useAlphaFromDiffuseTexture = true;
    this.puffMaterial.disableLighting = false;
    this.puffMaterial.specularColor = new Color3(0, 0, 0);
    this.puffMaterial.alpha = 0.92;

    this.shadowMaterial = new StandardMaterial('mat-cloud-shadow', scene);
    this.shadowMaterial.diffuseTexture = shadowTex;
    this.shadowMaterial.opacityTexture = shadowTex;
    this.shadowMaterial.useAlphaFromDiffuseTexture = true;
    this.shadowMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
    this.shadowMaterial.diffuseColor = new Color3(0.05, 0.05, 0.08);
    this.shadowMaterial.specularColor = new Color3(0, 0, 0);
    this.shadowMaterial.disableLighting = true;
    this.shadowMaterial.alpha = 0.5;
    this.shadowMaterial.backFaceCulling = false;

    this.applyLighting(preset);
  }

  /** 太阳参数变化时：更新云团明暗与投影方向/长度。 */
  applyLighting(preset: LightingPreset): void {
    this.preset = preset;
    const lit = Color3.FromArray(preset.cloudLit);
    const shade = Color3.FromArray(preset.cloudShadow);
    this.puffMaterial.diffuseColor = lit;
    this.puffMaterial.emissiveColor = shade.scale(0.35);
    this.puffMaterial.ambientColor = shade;

    const az = preset.azimuth;
    const el = Math.max(preset.elevation, 0.08);
    this.sunElevation = el;
    // 投影方向：云影落在太阳反方向地面上
    this.shadowDirection = { x: -Math.cos(az), z: -Math.sin(az) };
    // 低太阳角度下光线斜射、云影更浓；正午高太阳时投影更淡
    const heightFactor = Math.min(el / 1.1, 1);
    this.shadowMaterial.alpha = 0.24 + 0.32 * heightFactor;
    for (const visual of this.visuals.values()) {
      this.layoutShadow(visual);
    }
  }

  private buildPuffs(blob: CloudBlob, root: TransformNode): { puffs: Mesh[]; alphas: number[] } {
    const rng = new RNG(hashString(blob.id));
    const puffCount = 4 + blob.density * 2; // 6 / 8 / 10
    const layers = Math.min(blob.thickness, 3);
    const puffs: Mesh[] = [];
    const alphas: number[] = [];
    for (let i = 0; i < puffCount; i++) {
      const puff = MeshBuilder.CreatePlane(
        `puff-${blob.id}-${i}`,
        { size: 1, sideOrientation: Mesh.DOUBLESIDE },
        this.scene
      );
      puff.parent = root;
      puff.material = this.puffMaterial;
      puff.billboardMode = Mesh.BILLBOARDMODE_ALL;
      puff.isPickable = true;
      puff.metadata = { cloudId: blob.id };

      const ang = rng.next() * Math.PI * 2;
      const radial = Math.sqrt(rng.next()) * blob.radius * 0.55;
      const layer = i % layers;
      const vertical =
        (layer / Math.max(layers - 1, 1) - 0.5) * blob.radius * 0.42 * (blob.thickness / 2);
      puff.position.set(Math.cos(ang) * radial, vertical, Math.sin(ang) * radial);
      // 绒球直径略小于云团整体半径，多球拼合形成蓬松团块而非互相堆叠的大圆盘
      const ps = blob.radius * (0.42 + rng.next() * 0.34) * (1 + (blob.thickness - 1) * 0.1);
      puff.scaling.set(ps, ps * (0.8 + blob.thickness * 0.05), 1);
      const alpha = 0.5 + rng.next() * 0.28;
      alphas.push(alpha);
      puffs.push(puff);
    }
    return { puffs, alphas };
  }

  private buildShadow(blob: CloudBlob, root: TransformNode): { anchor: TransformNode; plane: Mesh } {
    // 锚点负责水平朝向（rotation.y），平面只负责翻平（rotation.x）与缩放，
    // 避免两个欧拉角叠加导致云影平面倾斜。
    const anchor = new TransformNode(`shadow-anchor-${blob.id}`, this.scene);
    anchor.parent = root;
    const shadow = MeshBuilder.CreatePlane(
      `shadow-${blob.id}`,
      { size: 1, sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    shadow.parent = anchor;
    shadow.material = this.shadowMaterial;
    shadow.rotation.x = Math.PI / 2;
    shadow.isPickable = false;
    shadow.scaling.set(blob.radius * 1.9, blob.radius * 1.9, 1);
    return { anchor, plane: shadow };
  }

  private buildSelector(root: TransformNode): Mesh {
    const ring = MeshBuilder.CreateTorus(
      'cloud-selector',
      { diameter: 1, thickness: 0.12, tessellation: 48 },
      this.scene
    );
    ring.parent = root;
    ring.material = this.selectorMaterial();
    ring.isPickable = false;
    ring.setEnabled(false);
    return ring;
  }

  private selectorMaterial(): StandardMaterial {
    const mat = new StandardMaterial('mat-cloud-selector', this.scene);
    mat.emissiveColor = new Color3(0.35, 0.75, 1.0);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    return mat;
  }

  /** 依据太阳方位与云高布局云影（相对 root 的本地坐标，root 位于云团中心）。 */
  private layoutShadow(visual: CloudVisual): void {
    const blob = this.blobOf(visual.blobId);
    if (!blob) return;
    const el = Math.max(this.sunElevation, 0.08);
    const reach = blob.radius * (0.5 + 0.9 / el) * 0.55;
    const dx = this.shadowDirection.x * reach;
    const dz = this.shadowDirection.z * reach;
    visual.shadowAnchor.position.set(dx, -visual.root.position.y + 0.6, dz);
    const stretch = 1 + Math.min(1.2 / el, 3.2) * 0.28;
    visual.shadow.scaling.set(blob.radius * 2 * stretch, blob.radius * 1.5, 1);
    // 在水平面上把椭圆长轴旋到太阳投影方向
    visual.shadowAnchor.rotation.y = Math.atan2(this.shadowDirection.x, this.shadowDirection.z);
  }

  private blobOf(id: string): CloudBlob | undefined {
    return this.blobProvider?.(id);
  }

  /** 由引擎注入：按 id 取最新云团数据，避免渲染层持有过期状态。 */
  blobProvider: ((id: string) => CloudBlob | undefined) | null = null;

  upsertCloud(blob: CloudBlob, groundY: number): void {
    let visual = this.visuals.get(blob.id);
    const key = structureKeyOf(blob);
    // 密度/厚度/半径变化时绒球数量与尺寸不同，需要销毁重建
    if (visual && visual.structureKey !== key) {
      this.removeCloud(blob.id);
      visual = undefined;
    }
    if (!visual) {
      const root = new TransformNode(`cloud-root-${blob.id}`, this.scene);
      const { puffs, alphas } = this.buildPuffs(blob, root);
      const { anchor, plane } = this.buildShadow(blob, root);
      const selector = this.buildSelector(root);
      visual = {
        blobId: blob.id,
        root,
        puffs,
        shadowAnchor: anchor,
        shadow: plane,
        selector,
        basePuffAlpha: alphas,
        structureKey: key
      };
      this.visuals.set(blob.id, visual);
    }
    this.syncVisual(blob, visual, groundY);
  }

  /** 位置/档位/显隐变化后的同步。 */
  syncVisual(blob: CloudBlob, visual: CloudVisual, groundY: number): void {
    const y = groundY + blob.clearance;
    visual.root.position.set(blob.x, y, blob.z);
    visual.root.setEnabled(blob.visible);
    // 显隐切换（半径/档位变化由 rebuildAll 重建绒球结构）
    for (const puff of visual.puffs) {
      puff.visibility = blob.visible ? 1 : 0;
    }
    this.layoutShadow(visual);
    visual.selector.scaling.set(blob.radius * 1.9, blob.radius * 1.9, blob.radius * 1.9);
    visual.selector.position.set(0, -y + 0.8, 0);
  }

  setSelected(id: string | null): void {
    for (const visual of this.visuals.values()) {
      const on = visual.blobId === id;
      visual.selector.setEnabled(on);
    }
  }

  removeCloud(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.puffs.forEach((p) => p.dispose());
    visual.shadow.dispose();
    visual.shadowAnchor.dispose();
    visual.selector.dispose();
    visual.root.dispose();
    this.visuals.delete(id);
  }

  clear(): void {
    for (const id of Array.from(this.visuals.keys())) this.removeCloud(id);
  }

  /** 移除不在保留集合中的云团视觉。 */
  retainOnly(ids: Set<string>): void {
    for (const id of Array.from(this.visuals.keys())) {
      if (!ids.has(id)) this.removeCloud(id);
    }
  }

  /** 重建全部云团视觉（档位结构变化时）。 */
  rebuildAll(blobs: CloudBlob[], heightAt: (x: number, z: number) => number): void {
    this.clear();
    for (const blob of blobs) {
      this.upsertCloud(blob, heightAt(blob.x, blob.z));
    }
  }

  /** 每帧轻量同步：云团跟随地形高度（笔刷拖拽过程中）。 */
  syncHeights(blobs: CloudBlob[], heightAt: (x: number, z: number) => number): void {
    for (const blob of blobs) {
      const visual = this.visuals.get(blob.id);
      if (!visual) continue;
      const y = heightAt(blob.x, blob.z) + blob.clearance;
      visual.root.position.set(blob.x, y, blob.z);
      visual.root.setEnabled(blob.visible);
      this.layoutShadow(visual);
      visual.selector.position.set(0, -y + 0.8, 0);
    }
  }

  pickCloudId(): string | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => m.isPickable && typeof m.metadata?.cloudId === 'string'
    );
    if (pick?.hit && pick.pickedMesh) {
      return (pick.pickedMesh.metadata as { cloudId: string }).cloudId;
    }
    return null;
  }

  get colorHint(): Color4 {
    const c = this.preset.skyHorizon;
    return new Color4(c[0], c[1], c[2], 1);
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
