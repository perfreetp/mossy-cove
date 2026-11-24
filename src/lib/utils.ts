import { Matrix, SVD, determinant as matrixDeterminant } from 'ml-matrix';
import * as THREE from 'three';
import type { QuatTuple, Vec3Tuple } from '../types';

export function uid(prefix = 'id'): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function float32ToBase64(array: Float32Array): string {
  return bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

export function base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  return new Float32Array(bytes.buffer.slice(0));
}

export function uint32ToBase64(array: Uint32Array): string {
  return bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

export function base64ToUint32(base64: string): Uint32Array {
  const bytes = base64ToBytes(base64);
  return new Uint32Array(bytes.buffer.slice(0));
}

export function poseFromObject3D(object: THREE.Object3D) {
  return {
    position: object.position.toArray() as Vec3Tuple,
    quaternion: object.quaternion.toArray() as QuatTuple,
    scale: object.scale.toArray() as Vec3Tuple,
  };
}

export function applyPoseToObject3D(object: THREE.Object3D, pose: {
  position: Vec3Tuple;
  quaternion: QuatTuple;
  scale: Vec3Tuple;
}): void {
  object.position.fromArray(pose.position);
  object.quaternion.fromArray(pose.quaternion);
  object.scale.fromArray(pose.scale);
  object.updateMatrix();
}

/**
 * Kabsch algorithm: finds rigid transform X such that target ≈ R * source + t
 * in the target fragment's local coordinate frame.
 */
export function kabsch(sourcePoints: Vec3Tuple[], targetPoints: Vec3Tuple[]): THREE.Matrix4 {
  if (sourcePoints.length < 3 || sourcePoints.length !== targetPoints.length) {
    throw new Error('Kabsch 需要至少 3 组且数量一致的特征点');
  }

  const source = sourcePoints.map((p) => new THREE.Vector3(...p));
  const target = targetPoints.map((p) => new THREE.Vector3(...p));
  const sourceCentroid = averageVector(source);
  const targetCentroid = averageVector(target);

  const sourceCentered = source.map((p) => p.clone().sub(sourceCentroid));
  const targetCentered = target.map((p) => p.clone().sub(targetCentroid));

  // Covariance H = Σ source_centered * target_centered^T.
  const h = new Matrix(3, 3);
  for (let i = 0; i < sourceCentered.length; i += 1) {
    const s = sourceCentered[i];
    const t = targetCentered[i];
    h.add(
      Matrix.columnVector([s.x, s.y, s.z]).mmul(
        Matrix.rowVector([t.x, t.y, t.z]),
      ),
    );
  }

  const svd = new SVD(h);
  const u = svd.leftSingularVectors;
  const v = svd.rightSingularVectors;
  const ut = u.transpose();
  let rotation = v.mmul(ut);

  // Reflection correction for R = V diag(1, 1, det(V U^T)) U^T.
  if (matrixDeterminant(rotation) < 0) {
    const correction = Matrix.eye(3);
    correction.set(2, 2, -1);
    rotation = v.mmul(correction).mmul(ut);
  }

  const r00 = rotation.get(0, 0);
  const r01 = rotation.get(0, 1);
  const r02 = rotation.get(0, 2);
  const r10 = rotation.get(1, 0);
  const r11 = rotation.get(1, 1);
  const r12 = rotation.get(1, 2);
  const r20 = rotation.get(2, 0);
  const r21 = rotation.get(2, 1);
  const r22 = rotation.get(2, 2);

  const rotatedSourceCentroid = new THREE.Vector3(
    r00 * sourceCentroid.x + r01 * sourceCentroid.y + r02 * sourceCentroid.z,
    r10 * sourceCentroid.x + r11 * sourceCentroid.y + r12 * sourceCentroid.z,
    r20 * sourceCentroid.x + r21 * sourceCentroid.y + r22 * sourceCentroid.z,
  );
  const translation = targetCentroid.clone().sub(rotatedSourceCentroid);

  return new THREE.Matrix4().set(
    r00, r01, r02, translation.x,
    r10, r11, r12, translation.y,
    r20, r21, r22, translation.z,
    0, 0, 0, 1,
  );
}

function averageVector(points: THREE.Vector3[]): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  points.forEach((p) => centroid.add(p));
  return centroid.multiplyScalar(1 / points.length);
}

export function rms(values: number[]): number {
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

/** Principal axis of vertex positions using a 3x3 covariance eigen analysis
 * through ml-matrix's symmetric eigenvalue decomposition.
 */
export function principalAxisFromPositions(positions: ArrayLike<number>): THREE.Vector3 {
  const count = positions.length / 3;
  const centroid = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    centroid.x += positions[i * 3];
    centroid.y += positions[i * 3 + 1];
    centroid.z += positions[i * 3 + 2];
  }
  centroid.multiplyScalar(1 / Math.max(1, count));

  const cov = new Matrix(3, 3);
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3] - centroid.x;
    const y = positions[i * 3 + 1] - centroid.y;
    const z = positions[i * 3 + 2] - centroid.z;
    const p = Matrix.columnVector([x, y, z]);
    cov.add(p.mmul(p.transpose()));
  }
  cov.divide(Math.max(1, count));

  // Power iteration is enough for an axis and avoids relying on EVD option names.
  let axis = new THREE.Vector3(0.31, 0.47, 0.83).normalize();
  const c = [
    [cov.get(0, 0), cov.get(0, 1), cov.get(0, 2)],
    [cov.get(1, 0), cov.get(1, 1), cov.get(1, 2)],
    [cov.get(2, 0), cov.get(2, 1), cov.get(2, 2)],
  ];
  for (let iter = 0; iter < 48; iter += 1) {
    const next = new THREE.Vector3(
      c[0][0] * axis.x + c[0][1] * axis.y + c[0][2] * axis.z,
      c[1][0] * axis.x + c[1][1] * axis.y + c[1][2] * axis.z,
      c[2][0] * axis.x + c[2][1] * axis.y + c[2][2] * axis.z,
    );
    if (next.lengthSq() < 1e-12) break;
    axis = next.normalize();
  }
  return axis;
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseJsonFile<T>(file: File): Promise<T> {
  return file.text().then((text) => JSON.parse(text) as T);
}
