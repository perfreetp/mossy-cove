import type { GatingNode, Vec3 } from './types';
import { distance } from './geometry';

/** 端点吸附容差（mm） */
export const SNAP_TOLERANCE = 20;

export interface SnapResult {
  position: Vec3;
  nodeId: string;
  distance: number;
}

/**
 * 吸附：把拖动中的位置对齐到已有浇道端点（节点）。
 * 排除正在拖动的节点自身。
 */
export function snapToEndpoints(
  position: Vec3,
  nodes: GatingNode[],
  excludeId: string | null,
  tolerance: number = SNAP_TOLERANCE
): SnapResult | null {
  let best: SnapResult | null = null;
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    const d = distance(position, node.position);
    if (d <= tolerance && (!best || d < best.distance)) {
      best = { position: { ...node.position }, nodeId: node.id, distance: d };
    }
  }
  return best;
}
