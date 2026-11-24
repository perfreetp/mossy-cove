import * as THREE from 'three';
import type { Side } from './types';

export const FACE = {
  centerY: 0.04,
  rx: 1.24,
  ry: 1.62,
  rz: 0.8,
};

export function sideSign(side: Side): number {
  return side === 'right' ? 1 : -1;
}

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** Front z coordinate of the stylized ellipsoid face at x/y. */
export function surfaceZ(x: number, y: number): number {
  const q =
    1 -
    (x * x) / (FACE.rx * FACE.rx) -
    ((y - FACE.centerY) * (y - FACE.centerY)) / (FACE.ry * FACE.ry);
  return FACE.rz * Math.sqrt(Math.max(0.001, q));
}

export function surfaceNormal(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const z = surfaceZ(x, y);
  out.set(
    x / (FACE.rx * FACE.rx),
    (y - FACE.centerY) / (FACE.ry * FACE.ry),
    z / (FACE.rz * FACE.rz),
  );
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
  return out.normalize();
}

/** Upper eyelid edge. t=0 inner corner, t=1 outer corner. */
export function eyelidPoint(side: Side, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = sideSign(side);
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  const x = s * (0.18 + 0.57 * tt);
  const y = 0.265 + 0.105 * Math.sin(Math.PI * tt) + 0.026 * tt;
  return out.set(x, y, surfaceZ(x, y) + 0.026);
}

export function eyelidTangent(side: Side, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = eyelidPoint(side, Math.max(0, t - 0.012));
  const b = eyelidPoint(side, Math.min(1, t + 0.012));
  return out.subVectors(b, a).normalize();
}

export function nearestEyelidT(side: Side, point: THREE.Vector3): number {
  let bestT = 0;
  let bestD = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    eyelidPoint(side, t, p);
    const d = p.distanceToSquared(point);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // One ternary refinement around the best sample.
  let lo = Math.max(0, bestT - 1 / 48);
  let hi = Math.min(1, bestT + 1 / 48);
  for (let i = 0; i < 10; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    const da = eyelidPoint(side, a, p).distanceToSquared(point);
    const db = eyelidPoint(side, b, p).distanceToSquared(point);
    if (da < db) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

export function eyeTarget(side: Side, out = new THREE.Vector3()): THREE.Vector3 {
  const s = sideSign(side);
  const x = s * 0.465;
  const y = 0.31;
  return out.set(x, y, surfaceZ(x, y) + 0.08);
}

export function createEyeSurfaceGeometry(side: Side): THREE.BufferGeometry {
  const upper: THREE.Vector2[] = [];
  const lower: THREE.Vector2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const p = eyelidPoint(side, t);
    upper.push(new THREE.Vector2(p.x, p.y));
  }
  for (let i = 28; i >= 0; i--) {
    const t = i / 28;
    const s = sideSign(side);
    const x = s * (0.18 + 0.57 * t);
    const y = 0.245 - 0.052 * Math.sin(Math.PI * t) + 0.006 * t;
    lower.push(new THREE.Vector2(x, y));
  }
  const shape = new THREE.Shape([...upper, ...lower]);
  const geometry = new THREE.ShapeGeometry(shape, 24);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, surfaceZ(x, y) + 0.012);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function makeEyelidCurve(side: Side): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 32; i++) points.push(eyelidPoint(side, i / 32));
  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}
