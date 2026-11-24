import * as THREE from 'three';
import { surfaceNormal, surfaceZ, sideSign } from './faceGeometry';
import { DENSITY_COUNTS, type Brow } from './types';

export interface BrowSample {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  perp: THREE.Vector3;
  width: number;
}

function smooth01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function browCurve(brow: Brow): THREE.CatmullRomCurve3 | null {
  if (brow.points.length < 2) return null;
  const points = brow.points.map(
    (p) => new THREE.Vector3(p.x, p.y, surfaceZ(p.x, p.y) + 0.032),
  );
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
}

function widthAt(brow: Brow, u: number): number {
  const points = brow.points;
  if (points.length === 1) return points[0].width;
  const scaled = THREE.MathUtils.clamp(u, 0, 1) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(scaled));
  const f = smooth01(scaled - i);
  let width = THREE.MathUtils.lerp(points[i].width, points[i + 1].width, f);

  const startTaper = points[0].taper ?? 0;
  const endTaper = points[points.length - 1].taper ?? 1;
  const ramp = 0.2;
  if (u < ramp) {
    const k = smooth01(u / ramp);
    const endpointFactor = 1 - startTaper;
    width *= endpointFactor + (1 - endpointFactor) * k;
  }
  const v = 1 - u;
  if (v < ramp) {
    const k = smooth01(v / ramp);
    const endpointFactor = 1 - endTaper;
    width *= endpointFactor + (1 - endpointFactor) * k;
  }
  return Math.max(0.002, width);
}

export function sampleBrow(brow: Brow, count = 88): BrowSample[] {
  const curve = browCurve(brow);
  if (!curve) return [];
  const result: BrowSample[] = [];
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    const center = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();
    const perp = new THREE.Vector3(-tangent.y, tangent.x, 0);
    if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0);
    perp.normalize();
    result.push({ center, tangent, perp, width: widthAt(brow, u) });
  }
  return result;
}

export function buildBrowRibbonGeometry(brow: Brow, widthMultiplier = 1): THREE.BufferGeometry | null {
  const samples = sampleBrow(brow, 96);
  if (samples.length < 2) return null;

  const positions = new Float32Array(samples.length * 2 * 3);
  const indices: number[] = [];

  samples.forEach((sample, i) => {
    [-1, 1].forEach((sideIndex, edge) => {
      const w = sample.width * widthMultiplier;
      const x = sample.center.x + sample.perp.x * w * sideIndex;
      const y = sample.center.y + sample.perp.y * w * sideIndex;
      const z = surfaceZ(x, y) + 0.041 + (widthMultiplier > 1 ? 0.006 : 0);
      const vertex = (i * 2 + edge) * 3;
      positions[vertex] = x;
      positions[vertex + 1] = y;
      positions[vertex + 2] = z;
    });
  });

  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function updateBrowHairs(mesh: THREE.InstancedMesh, brow: Brow): void {
  const samples = sampleBrow(brow, 120);
  const activeCount = DENSITY_COUNTS[brow.density] ?? DENSITY_COUNTS.natural;
  const maxCount = DENSITY_COUNTS.dense;
  mesh.count = activeCount;
  if (samples.length < 2) {
    mesh.count = 0;
    return;
  }

  const random = seededRandom(hashString(`${brow.id}-${brow.density}-${brow.points.length}`));
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const side = sideSign(brow.id);

  for (let i = 0; i < maxCount; i++) {
    if (i >= activeCount) {
      dummy.position.set(0, 0, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      continue;
    }

    const u = random();
    const sampleIndex = Math.min(samples.length - 1, Math.floor(u * (samples.length - 1)));
    const sample = samples[sampleIndex];
    const lateral = (random() * 2 - 1) * sample.width * 0.78;
    const rootX = sample.center.x + sample.perp.x * lateral;
    const rootY = sample.center.y + sample.perp.y * lateral;
    const rootZ = surfaceZ(rootX, rootY) + 0.057;

    const tangent = sample.tangent.clone();
    if (tangent.x * side < 0) tangent.negate();
    const normal = surfaceNormal(rootX, rootY, new THREE.Vector3());
    const direction = tangent
      .multiplyScalar(0.92)
      .add(new THREE.Vector3(0, 0.18, 0))
      .addScaledVector(normal, 0.22)
      .addScaledVector(sample.perp, (random() - 0.5) * 0.22)
      .normalize();

    const length = 0.043 + random() * 0.06;
    const radius = 0.0022 + random() * 0.0024;
    dummy.position.set(rootX, rootY, rootZ).addScaledVector(direction, length * 0.5);
    dummy.quaternion.setFromUnitVectors(up, direction);
    dummy.scale.set(radius, length, radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    color.setHSL(0.065 + random() * 0.025, 0.48, 0.1 + random() * 0.13);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function buildBrowHairs(brow: Brow): THREE.InstancedMesh {
  const maxCount = DENSITY_COUNTS.dense;
  const geometry = new THREE.ConeGeometry(1, 1, 5, 1);
  const material = new THREE.MeshStandardMaterial({
    color: '#2b1a11',
    roughness: 0.92,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.userData.kind = 'browHairs';
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  updateBrowHairs(mesh, brow);
  return mesh;
}
