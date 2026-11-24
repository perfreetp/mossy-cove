// 纯数学工具函数（不依赖 three 的部分，便于单元测试）
import type { JointLimit, Vec3Tuple } from '../types';

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

export const DEG = degToRad;

/** 角度转“度”文本，保留 1 位小数 */
export function formatDeg(rad: number): string {
  let d = radToDeg(rad);
  // 归一化到 (-180, 180]
  d = ((d + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(d) < 0.05) d = 0;
  return d.toFixed(1);
}

export interface ClampResult {
  value: Vec3Tuple;
  /** 哪些轴被顶到了极限 */
  hit: { x: boolean; y: boolean; z: boolean };
}

/**
 * 按关节活动范围钳制欧拉角（XYZ 顺序，各轴独立钳制）。
 * limit 为 null 的轴视为锁定（保持传入值不变）。
 */
export function clampRotation(current: Vec3Tuple, limits: JointLimit): ClampResult {
  const hit = { x: false, y: false, z: false };
  const value: Vec3Tuple = [current[0], current[1], current[2]];
  (['x', 'y', 'z'] as const).forEach((axis, i) => {
    const range = limits[axis];
    if (range) {
      const clamped = clamp(value[i], range[0], range[1]);
      if (clamped !== value[i]) hit[axis] = true;
      value[i] = clamped;
    }
  });
  return { value, hit };
}

/**
 * 矢状面（x → -x 反射）下的镜像欧拉角映射（XYZ 欧拉序）。
 * 反射矩阵 S=diag(-1,1,1)。端到端层级验证（test/debug-euler.ts）结论：
 *   镜像局部欧拉 = (+α, -β, -γ)
 * - x 旋转发生在矢状面内（屈伸），反射后方向不变，保持 +α；
 * - y（收展）与 z（扭转）在左右侧方向相反，取反。
 * 配合 R 模板几何（顶点已做 x 反射），可使 R 侧世界网格严格等于
 * S·(L 侧世界网格)，单轴测试误差为 0。
 */
export function mirrorEuler(r: Vec3Tuple): Vec3Tuple {
  return [r[0], -r[1], -r[2]];
}

/** 镜像插槽 / 几何位置点（x 取反） */
export function mirrorPoint(p: Vec3Tuple): Vec3Tuple {
  return [-p[0], p[1], p[2]];
}

export function v3add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function v3dist(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 生成骨骼实例 id（不使用 Math.random，用计数器由调用方传入） */
export function makeBoneId(baseId: string, side: string, n: number): string {
  return `${baseId}:${side}#${n}`;
}

/** 深拷贝项目快照（快照都是纯 JSON 数据） */
export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
