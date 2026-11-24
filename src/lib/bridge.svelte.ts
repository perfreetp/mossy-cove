import { Box3, Vector3 } from 'three';
import type { EvidenceMarker, PathKeyPoint } from '../types';
import type { ThreeSceneManager } from './three-manager';
import type { PlanMapManager } from './plan-map-manager';

/**
 * 三维视口与平面图之间的事件桥。
 * 两个组件生命周期独立，用单例解耦：
 * - 三维相机变化 -> 平面图位置指示
 * - 平面图点选/拖拽 -> 三维飞行/标记移动
 */
class Bridge {
  private three: ThreeSceneManager | null = null;
  private map: PlanMapManager | null = null;

  /** 平面图点选空白处，请求三维飞到 (x,z) */
  onLocate: ((x: number, z: number) => void) | null = null;
  /** 点云就绪回调（供晚挂载的组件订阅，attachThree 时会补发一次） */
  private cloudReadyHandlers = new Set<() => void>();

  attachThree(m: ThreeSceneManager): void {
    this.three = m;
    m.onCloudReady = () => {
      for (const h of this.cloudReadyHandlers) h();
    };
  }

  /** 订阅点云就绪；若已就绪则立即执行一次 */
  onCloudReady(handler: () => void): () => void {
    this.cloudReadyHandlers.add(handler);
    if (this.three?.cloudBox) handler();
    return () => this.cloudReadyHandlers.delete(handler);
  }

  attachMap(m: PlanMapManager): void {
    this.map = m;
  }

  detach(): void {
    this.three = null;
    this.map = null;
    this.cloudReadyHandlers.clear();
  }

  updateCamera(pos: Vector3, dir: Vector3): void {
    this.map?.updateCamera(pos, dir);
  }

  setBounds(box: Box3 | null): void {
    if (box) this.map?.setBounds(box);
  }

  setMarkers(markers: EvidenceMarker[]): void {
    this.map?.setMarkers(markers);
  }

  setPathPoints(points: PathKeyPoint[]): void {
    this.map?.setPathPoints(points);
  }

  get threeManager(): ThreeSceneManager | null {
    return this.three;
  }

  get mapManager(): PlanMapManager | null {
    return this.map;
  }
}

export const PlanMapBridge = new Bridge();
