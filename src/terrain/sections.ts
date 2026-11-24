import * as THREE from 'three';
import { BASE_Y, STRATA_COLORS, WORLD_SIZE } from './config';
import { sampleHeightWorld } from './heightfield';

export interface LayerRange {
  bottom: number;
  top: number;
  color: THREE.Color;
}

export function getLayerRanges(boundaries: number[]): LayerRange[] {
  const bottoms = [BASE_Y, ...boundaries];
  return STRATA_COLORS.map((color, i) => ({
    bottom: bottoms[i],
    top: i < boundaries.length ? boundaries[i] : 1000,
    color: new THREE.Color(color)
  }));
}

function pushVertex(positions: number[], colors: number[], x: number, y: number, z: number, color: THREE.Color) {
  positions.push(x, y, z);
  colors.push(color.r, color.g, color.b);
}

function pushQuad(
  positions: number[], colors: number[],
  a: [number, number, number], b: [number, number, number],
  c: [number, number, number], d: [number, number, number],
  color: THREE.Color
) {
  for (const p of [a, b, c, a, c, d]) pushVertex(positions, colors, p[0], p[1], p[2], color);
}

export function buildRibbonGeometry(
  axis: 'x' | 'z',
  fixed: number,
  heights: Float32Array,
  resolution: number,
  boundaries: number[]
): THREE.BufferGeometry {
  const segments = Math.min(160, resolution);
  const half = WORLD_SIZE / 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const layers = getLayerRanges(boundaries);

  const coords: number[] = [];
  const surface: number[] = [];
  for (let k = 0; k <= segments; k++) {
    const t = -half + (WORLD_SIZE * k) / segments;
    coords.push(t);
    const x = axis === 'x' ? fixed : t;
    const z = axis === 'x' ? t : fixed;
    surface.push(sampleHeightWorld(heights, resolution, x, z));
  }

  for (const layer of layers) {
    for (let k = 0; k < segments; k++) {
      const t0 = coords[k];
      const t1 = coords[k + 1];
      const top0 = Math.min(layer.top, surface[k]);
      const top1 = Math.min(layer.top, surface[k + 1]);
      const bottom0 = Math.max(layer.bottom, BASE_Y);
      const bottom1 = Math.max(layer.bottom, BASE_Y);
      if (top0 <= bottom0 || top1 <= bottom1) continue;

      if (axis === 'x') {
        pushQuad(
          positions, colors,
          [fixed, bottom0, t0], [fixed, top0, t0],
          [fixed, top1, t1], [fixed, bottom1, t1],
          layer.color
        );
      } else {
        pushQuad(
          positions, colors,
          [t0, bottom0, fixed], [t0, top0, fixed],
          [t1, top1, fixed], [t1, bottom1, fixed],
          layer.color
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildYCapGeometry(
  y: number,
  heights: Float32Array,
  resolution: number
): THREE.BufferGeometry {
  const segments = Math.min(128, resolution);
  const half = WORLD_SIZE / 2;
  const step = WORLD_SIZE / segments;
  const positions: number[] = [];

  for (let j = 0; j < segments; j++) {
    const z0 = -half + j * step;
    const z1 = z0 + step;
    for (let i = 0; i < segments; i++) {
      const x0 = -half + i * step;
      const x1 = x0 + step;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (sampleHeightWorld(heights, resolution, cx, cz) < y) continue;
      positions.push(
        x0, y, z0, x0, y, z1, x1, y, z1,
        x0, y, z0, x1, y, z1, x1, y, z0
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function strataColorAtY(y: number, boundaries: number[]): string {
  const ranges = getLayerRanges(boundaries);
  const found = ranges.find((layer) => y >= layer.bottom && y < layer.top);
  return `#${(found?.color ?? ranges[0].color).getHexString()}`;
}
