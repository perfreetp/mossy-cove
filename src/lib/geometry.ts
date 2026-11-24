import type { Vec3 } from './types';

let idCounter = 0;

/** 生成稳定的短 id */
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return lerp(a, b, 0.5);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 圆管截面积 mm² */
export function circleArea(diameter: number): number {
  return (Math.PI * diameter * diameter) / 4;
}

export function diameterFromArea(area: number): number {
  return Math.sqrt((4 * area) / Math.PI);
}

export function formatPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMm(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} mm`;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 纯数据深拷贝。
 * 不用 structuredClone：Svelte 5 的 $state 会把对象包成 Proxy，
 * structuredClone 遇到 Proxy 会抛 DataCloneError。
 * 领域模型只含普通对象/数组/原始值，JSON 往返即可满足且能自动解包 Proxy。
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
