import * as THREE from 'three';
import { eyelidPoint, eyelidTangent, surfaceNormal, surfaceZ } from './faceGeometry';
import type { Lash, LashRow } from './types';

const LENGTH_SEGMENTS = 8;
const RADIAL_SEGMENTS = 5;
const RING_VERTS = RADIAL_SEGMENTS + 1;
const VERTS_PER_LASH = (LENGTH_SEGMENTS + 1) * RING_VERTS;
const INDICES_PER_LASH = LENGTH_SEGMENTS * RADIAL_SEGMENTS * 6;
const TRIANGLES_PER_LASH = INDICES_PER_LASH / 3;

export function lashWorldLength(value: number): number {
  return value * 0.018;
}

export function lashWorldRadius(value: number): number {
  return 0.0024 + value * 0.00125;
}

function liftDirection(side: Lash['side'], t: number, out: THREE.Vector3): THREE.Vector3 {
  const tangent = eyelidTangent(side, t, new THREE.Vector3());
  out.set(-tangent.y, tangent.x, 0);
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
  out.normalize();
  if (out.y < 0) out.negate();
  return out;
}

export function getLashCenters(
  lash: Lash,
  row: LashRow | undefined,
  segments = LENGTH_SEGMENTS,
): THREE.Vector3[] {
  const liftDir = liftDirection(lash.side, lash.t, new THREE.Vector3());
  const anchor = eyelidPoint(lash.side, lash.t, new THREE.Vector3());
  anchor.addScaledVector(liftDir, row?.lift ?? 0);
  anchor.z = surfaceZ(anchor.x, anchor.y) + 0.03;

  const normal = surfaceNormal(anchor.x, anchor.y, new THREE.Vector3());
  const tangent = eyelidTangent(lash.side, lash.t, new THREE.Vector3());
  const rotation = THREE.MathUtils.degToRad(row?.rotation ?? 0);

  const d0 = normal
    .clone()
    .multiplyScalar(0.78)
    .add(new THREE.Vector3(0, 0.58, 0))
    .addScaledVector(tangent, Math.sin(rotation) * 0.9)
    .normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3().crossVectors(d0, up);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();

  const curl = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(lash.curl, 0, 110));
  const length = lashWorldLength(THREE.MathUtils.clamp(lash.length, 2, 24));
  const centers: THREE.Vector3[] = [anchor.clone()];

  for (let j = 1; j <= segments; j++) {
    const mid = (j - 0.5) / segments;
    const theta = curl * Math.pow(mid, 1.28);
    const dir = d0.clone().applyAxisAngle(axis, theta);
    centers.push(centers[j - 1].clone().addScaledVector(dir, length / segments));
  }
  return centers;
}

export class LashBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ids: string[] = [];
  private rows = new Map<string, LashRow>();

  constructor() {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: '#150d09',
      roughness: 0.58,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'batched-lashes';
    this.mesh.userData.kind = 'lashBatch';
  }

  setRows(rows: LashRow[]): void {
    this.rows = new Map(rows.map((row) => [row.id, row]));
  }

  private rowFor(lash: Lash): LashRow | undefined {
    return lash.rowId ? this.rows.get(lash.rowId) : undefined;
  }

  rebuild(lashes: Lash[], rows: LashRow[]): void {
    this.setRows(rows);
    this.ids = lashes.map((lash) => lash.id);
    const count = lashes.length;
    const positions = new Float32Array(count * VERTS_PER_LASH * 3);
    const indices =
      count > 0 ? new Uint32Array(count * INDICES_PER_LASH) : new Uint32Array(0);

    for (let i = 0; i < count; i++) {
      this.writeLashPositions(lashes[i], this.rowFor(lashes[i]), positions, i * VERTS_PER_LASH);
      const vertexBase = i * VERTS_PER_LASH;
      const indexBase = i * INDICES_PER_LASH;
      let at = indexBase;
      for (let j = 0; j < LENGTH_SEGMENTS; j++) {
        for (let k = 0; k < RADIAL_SEGMENTS; k++) {
          const a = vertexBase + j * RING_VERTS + k;
          const b = vertexBase + (j + 1) * RING_VERTS + k;
          const c = vertexBase + (j + 1) * RING_VERTS + k + 1;
          const d = vertexBase + j * RING_VERTS + k + 1;
          indices[at++] = a;
          indices[at++] = b;
          indices[at++] = d;
          indices[at++] = b;
          indices[at++] = c;
          indices[at++] = d;
        }
      }
    }

    const oldGeometry = this.mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.mesh.geometry = geometry;
    if (oldGeometry) oldGeometry.dispose();
  }

  updateLash(lash: Lash, rows?: LashRow[]): void {
    if (rows) this.setRows(rows);
    const slot = this.ids.indexOf(lash.id);
    const position = this.mesh.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (slot < 0 || !position) {
      this.rebuild([lash], rows ?? [...this.rows.values()]);
      return;
    }
    const array = position.array as Float32Array;
    this.writeLashPositions(
      lash,
      this.rowFor(lash),
      array,
      slot * VERTS_PER_LASH,
    );
    position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }

  pickLashId(faceIndex: number | null | undefined): string | null {
    if (faceIndex === null || faceIndex === undefined) return null;
    const slot = Math.floor(faceIndex / TRIANGLES_PER_LASH);
    return this.ids[slot] ?? null;
  }

  private writeLashPositions(
    lash: Lash,
    row: LashRow | undefined,
    array: Float32Array,
    vertexOffset: number,
  ): void {
    const centers = getLashCenters(lash, row);
    const radius = lashWorldRadius(lash.thickness);
    const referenceNormal = surfaceNormal(
      centers[0].x,
      centers[0].y,
      new THREE.Vector3(),
    );

    for (let j = 0; j <= LENGTH_SEGMENTS; j++) {
      const prev = centers[Math.max(0, j - 1)];
      const next = centers[Math.min(LENGTH_SEGMENTS, j + 1)];
      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      const n1 = new THREE.Vector3().crossVectors(tangent, referenceNormal);
      if (n1.lengthSq() < 1e-8) n1.crossVectors(tangent, new THREE.Vector3(1, 0, 0));
      if (n1.lengthSq() < 1e-8) n1.set(1, 0, 0);
      n1.normalize();
      const n2 = new THREE.Vector3().crossVectors(tangent, n1).normalize();
      const s = j / LENGTH_SEGMENTS;
      const ringRadius = radius * (1 - 0.86 * Math.pow(s, 0.8));

      for (let k = 0; k <= RADIAL_SEGMENTS; k++) {
        const angle = (k / RADIAL_SEGMENTS) * Math.PI * 2;
        const nx = Math.cos(angle) * n1.x + Math.sin(angle) * n2.x;
        const ny = Math.cos(angle) * n1.y + Math.sin(angle) * n2.y;
        const nz = Math.cos(angle) * n1.z + Math.sin(angle) * n2.z;
        const index = (vertexOffset + j * RING_VERTS + k) * 3;
        array[index] = centers[j].x + nx * ringRadius;
        array[index + 1] = centers[j].y + ny * ringRadius;
        array[index + 2] = centers[j].z + nz * ringRadius;
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
