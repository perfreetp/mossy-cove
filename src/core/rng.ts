/** 确定性伪随机工具：重散布 / 导入恢复时保证结果可复现 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数混合哈希，用于把多个种子字段合成一个 32 位种子 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let v = p | 0;
    h = Math.imul(h ^ (v & 255), 0x01000193);
    v >>>= 8;
    h = Math.imul(h ^ (v & 255), 0x01000193);
    v >>>= 8;
    h = Math.imul(h ^ (v & 255), 0x01000193);
    v >>>= 8;
    h = Math.imul(h ^ (v & 255), 0x01000193);
  }
  return h >>> 0;
}

/** 字符串 id -> 32 位哈希 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let idCounter = 0;
/** 生成运行时唯一 id（不参与确定性散布） */
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
}
