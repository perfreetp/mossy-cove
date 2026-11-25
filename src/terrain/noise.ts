/** Deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueNoise2D(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smooth(x - x0)
  const ty = smooth(y - y0)

  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)

  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
}

export function fbm(
  x: number,
  y: number,
  seed: number,
  octaves = 5,
  lacunarity = 2.03,
  gain = 0.5,
): number {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let norm = 0

  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + i * 1013) * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / norm
}

/** Ridged multifractal in approximately 0..1. */
export function ridgedFbm(
  x: number,
  y: number,
  seed: number,
  octaves = 5,
  lacunarity = 2.1,
  gain = 0.52,
): number {
  let amplitude = 0.55
  let frequency = 1
  let sum = 0
  let norm = 0

  for (let i = 0; i < octaves; i += 1) {
    const n = valueNoise2D(x * frequency, y * frequency, seed + i * 1619) * 2 - 1
    let ridge = 1 - Math.abs(n)
    ridge *= ridge
    sum += ridge * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / norm
}
