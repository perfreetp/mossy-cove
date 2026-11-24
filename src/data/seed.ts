import { BUILDING_DEFS } from '../data/library'
import type { Building, BuildingDef, Street } from '../types'
import { obbAABB, nearestOnPolyline, streetPlacementPose, uid } from '../utils/geometry'

export function createBuildingFromDef(def: BuildingDef, x: number, z: number, rotation = 0): Building {
  return {
    id: uid('b'),
    defId: def.defId,
    name: def.name,
    category: def.category,
    tier: def.tier,
    tierName: def.tierName,
    width: def.width,
    depth: def.depth,
    height: def.height,
    color: def.color,
    roof: def.roof,
    x,
    z,
    rotation,
    streetId: null,
    streetSide: null,
    streetU: null
  }
}

function makeStreets(): Street[] {
  return [
    {
      id: 'street-main',
      name: '中央大道',
      points: [
        { x: -54, z: -2 },
        { x: -28, z: -6 },
        { x: -4, z: 2 },
        { x: 22, z: 4 },
        { x: 54, z: -1 }
      ],
      width: 6,
      setback: 2.5,
      color: '#475569'
    },
    {
      id: 'street-cross',
      name: '纵一街',
      points: [
        { x: 4, z: -42 },
        { x: 1, z: -22 },
        { x: -5, z: -4 },
        { x: -2, z: 18 },
        { x: 3, z: 42 }
      ],
      width: 5,
      setback: 2.2,
      color: '#4b5563'
    }
  ]
}

function intersectsAny(b: Building, others: Building[], padding = 0.8): boolean {
  const a = obbAABB(b)
  for (const o of others) {
    const c = obbAABB(o)
    const overlapX = a.minX - padding < c.maxX && a.maxX + padding > c.minX
    const overlapZ = a.minZ - padding < c.maxZ && a.maxZ + padding > c.minZ
    if (overlapX && overlapZ) return true
  }
  return false
}

function clearsStreets(b: Building, streets: Street[]): boolean {
  for (const street of streets) {
    const nearest = nearestOnPolyline(b, street.points)
    if (!nearest) continue
    const required = street.width / 2 + street.setback + Math.max(b.width, b.depth) / 2 + 1.2
    if (nearest.distance < required) return false
  }
  return true
}

export function createSeedProject(): { buildings: Building[]; streets: Street[] } {
  const streets = makeStreets()
  const buildings: Building[] = []

  const resDefs = BUILDING_DEFS.filter((d) => d.category === 'residential')
  const towerDefs = BUILDING_DEFS.filter((d) => d.category === 'tower')
  const warehouseDefs = BUILDING_DEFS.filter((d) => d.category === 'warehouse')

  // Buildings bound to the two editable street polylines.
  const mainUs = [0.07, 0.18, 0.29, 0.62, 0.73, 0.84, 0.94]
  mainUs.forEach((u, i) => {
    for (const side of [1, -1] as const) {
      const def = (i + (side === 1 ? 0 : 2)) % 3 === 0 ? towerDefs[i % 4] : resDefs[(i + 1) % 6]
      const pose = streetPlacementPose(streets[0], u, side, def.depth)
      const b = createBuildingFromDef(def, pose.x, pose.z, pose.rotation)
      b.streetId = streets[0].id
      b.streetSide = side
      b.streetU = u
      buildings.push(b)
    }
  })

  const crossUs = [0.1, 0.27, 0.4, 0.66, 0.8, 0.92]
  crossUs.forEach((u, i) => {
    for (const side of [1, -1] as const) {
      const def = i % 3 === 0 ? towerDefs[(i + 1) % 4] : resDefs[(i + 3) % 6]
      const pose = streetPlacementPose(streets[1], u, side, def.depth)
      const b = createBuildingFromDef(def, pose.x, pose.z, pose.rotation)
      b.streetId = streets[1].id
      b.streetSide = side
      b.streetU = u
      buildings.push(b)
    }
  })

  // Deterministic collision-aware city blocks bring the starter to 96 buildings.
  let cursor = 0
  for (let z = -40; z <= 40 && buildings.length < 96; z += 7.5) {
    for (let x = -52; x <= 52 && buildings.length < 96; x += 7.2) {
      cursor++
      const edgeZone = Math.abs(z) > 27 || Math.abs(x) > 43
      const useWarehouse = edgeZone && cursor % 4 === 0
      const useTower = !useWarehouse && cursor % 5 === 0
      const def = useWarehouse
        ? warehouseDefs[(cursor % 5) + 1]
        : useTower
          ? towerDefs[cursor % 5]
          : resDefs[cursor % 6]

      const jitterX = ((cursor * 17) % 9) * 0.35 - 1.4
      const jitterZ = ((cursor * 29) % 7) * 0.35 - 1.05
      const rotation = cursor % 7 === 0 ? Math.PI / 2 : 0
      const candidate = createBuildingFromDef(def, Math.round((x + jitterX) * 2) / 2, Math.round((z + jitterZ) * 2) / 2, rotation)

      if (intersectsAny(candidate, buildings) || !clearsStreets(candidate, streets)) continue
      buildings.push(candidate)
    }
  }

  return { buildings, streets }
}
