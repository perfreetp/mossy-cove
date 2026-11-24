import { BUILDING_DEF_MAP } from '../data/library'
import { store } from '../state/store'
import type { Building, ProjectFile, ProjectSnapshot, Street } from '../types'
import { degToRad, radToDeg, uid } from './geometry'

function round(value: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

export function serializeProject(): string {
  const payload: ProjectFile = {
    app: 'mini-sandbox-planner',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...store.settings },
    buildings: store.buildings.map((b) => {
      const x = round(b.x)
      const z = round(b.z)
      const rotation = round(b.rotation, 5)
      return {
        id: b.id,
        defId: b.defId,
        name: b.name,
        category: b.category,
        tier: b.tier,
        tierName: b.tierName,
        roof: b.roof,
        position: { x, y: 0, z },
        dimensions: { width: b.width, depth: b.depth, height: b.height },
        orientation: {
          radians: rotation,
          degrees: round(radToDeg(b.rotation), 3),
          stepDegrees: 15 as const
        },
        streetBinding:
          b.streetId && b.streetSide != null && b.streetU != null
            ? { streetId: b.streetId, side: b.streetSide, u: b.streetU }
            : null,
        x,
        z,
        width: b.width,
        depth: b.depth,
        height: b.height,
        rotation,
        rotationDegrees: round(radToDeg(b.rotation), 3)
      }
    }),
    streets: store.streets.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: round(p.x), z: round(p.z) }))
    }))
  }

  return JSON.stringify(payload, null, 2)
}

export function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeImportedProject(raw: unknown): ProjectSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('JSON 根节点必须是对象')
  const obj = raw as Record<string, unknown>

  const rawBuildings = Array.isArray(obj.buildings) ? obj.buildings : []
  const rawStreets = Array.isArray(obj.streets) ? obj.streets : []

  const buildings: Building[] = rawBuildings.map((item, index) => {
    const r = (item ?? {}) as Record<string, unknown>
    const position = (r.position ?? {}) as Record<string, unknown>
    const dimensions = (r.dimensions ?? {}) as Record<string, unknown>
    const orientation = (r.orientation ?? {}) as Record<string, unknown>
    const binding = (r.streetBinding ?? {}) as Record<string, unknown>
    const defId = typeof r.defId === 'string' ? r.defId : typeof r.libraryId === 'string' ? r.libraryId : ''
    const def = defId ? BUILDING_DEF_MAP.get(defId) : undefined

    const x = asNumber(r.x ?? position.x ?? position.X, index * 2)
    const z = asNumber(r.z ?? position.z ?? position.Z ?? position.y, 0)
    const width = asNumber(r.width ?? dimensions.width ?? dimensions.w, def?.width ?? 5)
    const depth = asNumber(r.depth ?? dimensions.depth ?? dimensions.d, def?.depth ?? 5)
    const height = asNumber(r.height ?? dimensions.height ?? dimensions.h, def?.height ?? 8)

    let rotation = asNumber(r.rotation ?? orientation.radians ?? orientation.rotation, 0)
    const degrees = orientation.degrees ?? r.rotationDegrees
    if (typeof degrees === 'number' && Number.isFinite(degrees) && (r.rotation === undefined || orientation.radians === undefined)) {
      rotation = degToRad(degrees)
    }

    return {
      id: typeof r.id === 'string' ? r.id : uid('b-import'),
      defId: def?.defId ?? defId ?? 'imported',
      name: typeof r.name === 'string' ? r.name : def?.name ?? `导入建筑 ${index + 1}`,
      category: (r.category as Building['category']) ?? def?.category ?? 'residential',
      tier: asNumber(r.tier, def?.tier ?? 1),
      tierName: typeof r.tierName === 'string' ? r.tierName : def?.tierName ?? 'T?',
      width,
      depth,
      height,
      color: typeof r.color === 'string' ? r.color : def?.color ?? '#94a3b8',
      roof: (r.roof as Building['roof']) ?? def?.roof ?? 'flat',
      x,
      z,
      rotation,
      streetId: (r.streetId as string | null | undefined) ?? (binding.streetId as string | undefined) ?? null,
      streetSide:
        (r.streetSide as 1 | -1 | null | undefined) ?? (binding.side as 1 | -1 | undefined) ?? null,
      streetU:
        typeof r.streetU === 'number'
          ? r.streetU
          : typeof binding.u === 'number'
            ? binding.u
            : null
    }
  })

  const streets: Street[] = rawStreets.map((item, index) => {
    const r = (item ?? {}) as Record<string, unknown>
    const rawPoints = Array.isArray(r.points) ? r.points : Array.isArray(r.polyline) ? r.polyline : []
    const points = rawPoints
      .map((p) => {
        const point = (p ?? {}) as Record<string, unknown>
        return {
          x: asNumber(point.x ?? point.X, 0),
          z: asNumber(point.z ?? point.Z ?? point.y, 0)
        }
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))

    return {
      id: typeof r.id === 'string' ? r.id : uid('street-import'),
      name: typeof r.name === 'string' ? r.name : `导入街道 ${index + 1}`,
      points,
      width: asNumber(r.width, 5),
      setback: asNumber(r.setback, 2.2),
      color: typeof r.color === 'string' ? r.color : '#475569'
    }
  })

  return { buildings, streets }
}

export async function readJsonFile(file: File): Promise<ProjectSnapshot> {
  const text = await file.text()
  return normalizeImportedProject(JSON.parse(text))
}
