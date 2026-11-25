import { HEIGHT_RES } from '../constants'
import type { TerrainParams } from '../types'
import { fbm, mulberry32, ridgedFbm } from './noise'

function erodeHydraulic(field: Float32Array, size: number, strength: number, seed: number): void {
  if (strength <= 0.001) return

  const random = mulberry32((seed ^ 0x51ed270b) >>> 0)
  const dropletCount = Math.round(900 + strength * 4200)
  const erosionRate = 0.16 + strength * 0.34
  const depositRate = 0.24
  const inertia = 0.08
  const gravity = 4.2
  const capacityFactor = 5.2
  const evaporateSpeed = 0.025
  const maxLifetime = 44

  // Work in relief-scale units so gradient/capacity constants are meaningful.
  for (let i = 0; i < field.length; i += 1) field[i] *= 120

  const sampleHeight = (x: number, y: number): { height: number; gx: number; gy: number } => {
    const ix = Math.min(size - 2, Math.max(0, Math.floor(x)))
    const iy = Math.min(size - 2, Math.max(0, Math.floor(y)))
    const tx = Math.min(1, Math.max(0, x - ix))
    const ty = Math.min(1, Math.max(0, y - iy))
    const i00 = iy * size + ix
    const i10 = i00 + 1
    const i01 = i00 + size
    const i11 = i01 + 1
    const h00 = field[i00]
    const h10 = field[i10]
    const h01 = field[i01]
    const h11 = field[i11]

    const top = h00 + (h10 - h00) * tx
    const bottom = h01 + (h11 - h01) * tx
    return {
      height: top + (bottom - top) * ty,
      gx: (h10 - h00) * (1 - ty) + (h11 - h01) * ty,
      gy: (h01 - h00) * (1 - tx) + (h11 - h10) * tx,
    }
  }

  const deposit = (x: number, y: number, amount: number): void => {
    const ix = Math.min(size - 2, Math.max(0, Math.floor(x)))
    const iy = Math.min(size - 2, Math.max(0, Math.floor(y)))
    const tx = Math.min(1, Math.max(0, x - ix))
    const ty = Math.min(1, Math.max(0, y - iy))
    const i00 = iy * size + ix
    field[i00] += amount * (1 - tx) * (1 - ty)
    field[i00 + 1] += amount * tx * (1 - ty)
    field[i00 + size] += amount * (1 - tx) * ty
    field[i00 + size + 1] += amount * tx * ty
  }

  for (let d = 0; d < dropletCount; d += 1) {
    let x = 1 + random() * (size - 3)
    let y = 1 + random() * (size - 3)
    let dirX = 0
    let dirY = 0
    let speed = 1
    let water = 1
    let sediment = 0

    for (let life = 0; life < maxLifetime; life += 1) {
      const old = sampleHeight(x, y)
      dirX = dirX * inertia - old.gx * (1 - inertia)
      dirY = dirY * inertia - old.gy * (1 - inertia)

      const length = Math.hypot(dirX, dirY)
      if (length < 1e-7) {
        const angle = random() * Math.PI * 2
        dirX = Math.cos(angle) * 0.15
        dirY = Math.sin(angle) * 0.15
      } else if (length > 1.4) {
        dirX /= length / 1.4
        dirY /= length / 1.4
      }

      const nextX = x + dirX
      const nextY = y + dirY
      if (nextX < 1 || nextX >= size - 2 || nextY < 1 || nextY >= size - 2) break

      const next = sampleHeight(nextX, nextY)
      const delta = next.height - old.height
      const capacity = Math.max(-delta, 0.02) * speed * water * capacityFactor

      if (sediment > capacity || delta > 0.01) {
        const amount = delta > 0.01 ? Math.min(delta, sediment) : (sediment - capacity) * depositRate
        if (amount > 0) {
          deposit(x, y, amount)
          sediment -= amount
        }
      } else {
        const amount = Math.min((capacity - sediment) * erosionRate, Math.max(0, -delta) + 0.35)
        if (amount > 0) {
          // Bilinear erosion keeps the operation cheap and smooth enough for dragging.
          const ix = Math.floor(x)
          const iy = Math.floor(y)
          const tx = x - ix
          const ty = y - iy
          const w00 = (1 - tx) * (1 - ty)
          const w10 = tx * (1 - ty)
          const w01 = (1 - tx) * ty
          const w11 = tx * ty
          const i00 = iy * size + ix
          field[i00] = Math.max(0, field[i00] - amount * w00)
          field[i00 + 1] = Math.max(0, field[i00 + 1] - amount * w10)
          field[i00 + size] = Math.max(0, field[i00 + size] - amount * w01)
          field[i00 + size + 1] = Math.max(0, field[i00 + size + 1] - amount * w11)
          sediment += amount
        }
      }

      speed = Math.sqrt(Math.max(0.05, speed * speed + delta * gravity))
      water *= 1 - evaporateSpeed
      x = nextX
      y = nextY
    }
  }

  for (let i = 0; i < field.length; i += 1) field[i] /= 120
}

/** Generates a deterministic normalized row-major height field. */
export function generateHeightField(params: TerrainParams, resolution = HEIGHT_RES): number[] {
  const raw = new Float32Array(resolution * resolution)
  const frequency = params.frequency

  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = x / (resolution - 1) - 0.5
      const v = y / (resolution - 1) - 0.5
      const px = u * frequency * 3.4 + 17.31
      const py = v * frequency * 3.4 - 9.47
      const warpX = (fbm(px * 0.62 + 4.1, py * 0.62, params.seed + 71, 3) - 0.5) * 1.25
      const warpY = (fbm(px * 0.62, py * 0.62 - 8.3, params.seed + 137, 3) - 0.5) * 1.25

      const broad = fbm(px * 0.76 + warpX, py * 0.76 + warpY, params.seed + 11, 4)
      const ridge = ridgedFbm(px * 1.04 + warpX * 0.55, py * 1.04 + warpY * 0.55, params.seed + 29, 4, 2.02, 0.5)
      const detail = fbm(px * 2.15, py * 2.15, params.seed + 53, 3)

      let h = 0
      if (params.style === 'rolling') {
        h = 0.22 + 0.62 * Math.pow(broad, 1.22) + 0.08 * ridge + 0.05 * detail
      } else if (params.style === 'alpine') {
        h = 0.08 + 0.7 * Math.pow(ridge, 1.42) + 0.19 * broad + 0.06 * detail
      } else {
        h = 0.16 + 0.57 * Math.pow(ridge, 1.04) + 0.24 * broad + 0.05 * detail
      }

      // A very gentle centre weight helps layers read as one connected range.
      const radial = Math.hypot(u * 1.05, v * 1.05)
      h *= 1.04 - Math.max(0, radial - 0.42) * 0.28
      raw[y * resolution + x] = h
    }
  }

  erodeHydraulic(raw, resolution, params.erosion, params.seed)

  // One light neighbour pass removes single-sample needles while preserving ridge lines.
  const smoothed = Float32Array.from(raw)
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const i = y * resolution + x
      const left = raw[y * resolution + Math.max(0, x - 1)]
      const right = raw[y * resolution + Math.min(resolution - 1, x + 1)]
      const up = raw[Math.max(0, y - 1) * resolution + x]
      const down = raw[Math.min(resolution - 1, y + 1) * resolution + x]
      smoothed[i] = raw[i] * 0.52 + (left + right + up + down) * 0.12
    }
  }

  const sorted = Array.from(smoothed).sort((a, b) => a - b)
  const lowIndex = Math.floor((sorted.length - 1) * 0.015)
  const highIndex = Math.ceil((sorted.length - 1) * 0.985)
  const min = sorted[lowIndex] ?? sorted[0]
  const max = sorted[highIndex] ?? sorted[sorted.length - 1]
  const range = Math.max(1e-5, max - min)
  const result: number[] = new Array(smoothed.length)
  for (let i = 0; i < smoothed.length; i += 1) {
    result[i] = Math.min(1, Math.max(0, (smoothed[i] - min) / range))
  }
  return result
}
