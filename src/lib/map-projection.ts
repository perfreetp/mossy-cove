import { Box3 } from 'three';
import type { MapViewState } from '../types';

/**
 * 世界坐标（三维）与平面图画布坐标（二维像素）之间的映射。
 *
 * 俯视图取世界 XZ 平面：
 *   画布 x = (worldX - originX) * scale + offsetX
 *   画布 y = (originZ - worldZ) * scale + offsetY   （Z 轴翻转，画布向下为正）
 *
 * scale/offset 即缩放与平移状态，裁剪变化时只更新 origin 与包围盒，
 * 缩放和平移通过同一套公式作用，保证映射始终准确。
 */
export class PlanMapProjection {
  /** 世界原点（通常为当前裁剪盒 min）在世界坐标中的位置 */
  originX = 0;
  originZ = 0;
  scale = 50;
  offsetX = 40;
  offsetY = 40;

  setOrigin(box: Box3): void {
    this.originX = box.min.x;
    this.originZ = box.min.z;
  }

  worldToCanvas(x: number, z: number): { x: number; y: number } {
    return {
      x: (x - this.originX) * this.scale + this.offsetX,
      y: (this.originZ - z) * this.scale + this.offsetY
    };
  }

  canvasToWorld(cx: number, cz: number): { x: number; z: number } {
    return {
      x: (cx - this.offsetX) / this.scale + this.originX,
      z: this.originZ - (cz - this.offsetY) / this.scale
    };
  }

  /** 让给定包围盒完整适配画布（留边距） */
  fitBox(box: Box3, canvasWidth: number, canvasHeight: number, padding = 36): void {
    const sx = box.max.x - box.min.x;
    const sz = box.max.z - box.min.z;
    const usableW = Math.max(1, canvasWidth - padding * 2);
    const usableH = Math.max(1, canvasHeight - padding * 2);
    this.scale = Math.min(usableW / Math.max(sx, 1e-6), usableH / Math.max(sz, 1e-6));
    this.originX = box.min.x;
    this.originZ = box.min.z;
    // 水平方向：canvasX 随 worldX 线性增长，常规居中
    const contentW = sx * this.scale;
    this.offsetX = (canvasWidth - contentW) / 2;
    // 垂直方向：canvasY = (originZ - worldZ) * scale + offsetY，世界 Z 越大画布越靠上，
    // 因此包围盒在画布上占据 [offsetY - sz*scale, offsetY]，需反向居中
    const contentH = sz * this.scale;
    this.offsetY = (canvasHeight + contentH) / 2;
  }

  zoom(factor: number, anchorCanvas: { x: number; y: number }): void {
    // 以鼠标位置为锚点缩放：缩放后锚点下的世界点保持不动
    const before = this.canvasToWorld(anchorCanvas.x, anchorCanvas.y);
    this.scale = Math.min(5000, Math.max(1, this.scale * factor));
    const after = this.worldToCanvas(before.x, before.z);
    this.offsetX += anchorCanvas.x - after.x;
    this.offsetY += anchorCanvas.y - after.y;
  }

  pan(dxCanvas: number, dyCanvas: number): void {
    this.offsetX += dxCanvas;
    this.offsetY += dyCanvas;
  }

  serialize(): MapViewState {
    return { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY };
  }

  restore(state: MapViewState): void {
    this.scale = state.scale;
    this.offsetX = state.offsetX;
    this.offsetY = state.offsetY;
  }
}
