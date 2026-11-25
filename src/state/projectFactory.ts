import { HEIGHT_RES, MASK_RES } from '../constants'
import { generateHeightField } from '../terrain/generate'
import { fullMaskBase64 } from '../terrain/maskCodec'
import type { CloudBand, ProjectData, ReliefStyle } from '../types'

export function createBand(index: number, partial: Partial<CloudBand> = {}): CloudBand {
  const altitudeDefaults = [30, 46, 64, 82]
  const thicknessDefaults = [9, 11, 13, 15]
  return {
    id: partial.id ?? `band-${Date.now().toString(36)}-${index}-${Math.round(Math.random() * 1e6).toString(36)}`,
    name: partial.name ?? `云带 ${index + 1}`,
    altitude: partial.altitude ?? altitudeDefaults[index] ?? 50 + index * 12,
    thickness: partial.thickness ?? thicknessDefaults[index] ?? 12,
    coverage: partial.coverage ?? [0.66, 0.58, 0.48, 0.4][index] ?? 0.5,
    density: partial.density ?? [0.82, 0.78, 0.72, 0.66][index] ?? 0.75,
    visible: partial.visible ?? true,
    mask: partial.mask ?? '',
  }
}

export function createDefaultProject(): ProjectData {
  const terrain = {
    seed: 20261125,
    ridgeHeight: 62,
    frequency: 1.05,
    erosion: 0.42,
    style: 'ridges' as ReliefStyle,
  }
  return {
    app: 'cloud-sea-terrain-generator',
    formatVersion: 1,
    name: '未命名云海地形',
    heightResolution: HEIGHT_RES,
    maskResolution: MASK_RES,
    terrain,
    heights: generateHeightField(terrain),
    bands: [createBand(0, { id: 'band-low', name: '低层云海', altitude: 27, coverage: 0.72, density: 0.86 }), createBand(1, { id: 'band-mid', name: '中层云带', altitude: 45, coverage: 0.58, density: 0.78 }), createBand(2, { id: 'band-high', name: '高层薄云', altitude: 66, coverage: 0.42, density: 0.62 })],
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function isReliefStyle(value: unknown): value is ReliefStyle {
  return value === 'rolling' || value === 'ridges' || value === 'alpine'
}

/** Validates imported/stored JSON and upgrades missing fields to safe defaults. */
export function normalizeProject(raw: unknown): ProjectData {
  const fallback = createDefaultProject()
  if (!raw || typeof raw !== 'object') return fallback
  const source = raw as Partial<ProjectData> & { terrain?: Partial<ProjectData['terrain']> }

  const terrain = {
    seed: Math.round(clampNumber(source.terrain?.seed, 1, 2_147_483_647, fallback.terrain.seed)),
    ridgeHeight: clampNumber(source.terrain?.ridgeHeight, 12, 130, fallback.terrain.ridgeHeight),
    frequency: clampNumber(source.terrain?.frequency, 0.55, 3.2, fallback.terrain.frequency),
    erosion: clampNumber(source.terrain?.erosion, 0, 1, fallback.terrain.erosion),
    style: isReliefStyle(source.terrain?.style) ? source.terrain.style : fallback.terrain.style,
  }

  let heights: number[] = fallback.heights
  if (
    Array.isArray(source.heights) &&
    source.heights.length === HEIGHT_RES * HEIGHT_RES &&
    source.heights.every((h) => Number.isFinite(Number(h)))
  ) {
    heights = source.heights.map((h) => clampNumber(h, 0, 1, 0))
  } else if (source.terrain) {
    heights = generateHeightField(terrain)
  }

  let bands: CloudBand[] = fallback.bands
  if (Array.isArray(source.bands) && source.bands.length >= 2) {
    bands = source.bands.slice(0, 4).map((rawBand, index) => {
      const b = (rawBand ?? {}) as Partial<CloudBand>
      return createBand(index, {
        id: typeof b.id === 'string' && b.id ? b.id : `imported-band-${index}`,
        name: typeof b.name === 'string' && b.name ? b.name : `云带 ${index + 1}`,
        altitude: clampNumber(b.altitude, 6, 105, fallback.bands[index]?.altitude ?? 45 + index * 15),
        thickness: clampNumber(b.thickness, 2, 30, fallback.bands[index]?.thickness ?? 12),
        coverage: clampNumber(b.coverage, 0, 1, fallback.bands[index]?.coverage ?? 0.55),
        density: clampNumber(b.density, 0.05, 1, fallback.bands[index]?.density ?? 0.75),
        visible: typeof b.visible === 'boolean' ? b.visible : true,
        mask: typeof b.mask === 'string' ? b.mask : '',
      })
    })
    while (bands.length < 2) bands.push(createBand(bands.length))
  }

  return {
    app: 'cloud-sea-terrain-generator',
    formatVersion: 1,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.slice(0, 80) : fallback.name,
    heightResolution: HEIGHT_RES,
    maskResolution: MASK_RES,
    terrain,
    heights,
    bands,
  }
}

export { fullMaskBase64 }
