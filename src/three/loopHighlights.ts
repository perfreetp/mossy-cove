import * as THREE from 'three';
import type { BoundaryLoop } from '../types';

export interface LoopHighlight {
  line: THREE.LineLoop;
  loop: BoundaryLoop;
}

/**
 * 把边界环构建为高亮 LineLoop：切割断面环用醒目金色、加粗线宽效果
 * （WebGL lineWidth 限制下用双层线：底层粗辉光 + 顶层亮线）。
 */
export function makeLoopHighlights(
  geometry: THREE.BufferGeometry,
  loops: BoundaryLoop[],
): LoopHighlight[] {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const result: LoopHighlight[] = [];

  loops.forEach((loop) => {
    const positions: number[] = [];
    for (const id of loop.indices) {
      positions.push(posAttr.getX(id), posAttr.getY(id), posAttr.getZ(id));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffd54a,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.LineLoop(geo, mat);
    // 沿断面法向轻微外移，避免与网格表面 z-fighting
    line.position.addScaledVector(loop.plane.normal, 0.002);
    result.push({ line, loop });
  });

  return result;
}
