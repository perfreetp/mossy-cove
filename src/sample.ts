import { MATERIALS } from './constants'
import type { NetworkData } from './types'

/** 生成一个带主次干道、丁字/十字路口与角度约束的示例路网 */
export function sampleNetwork(): NetworkData {
  const ids = {
    n1: 'n_seed_1',
    n2: 'n_seed_2',
    n3: 'n_seed_3',
    n4: 'n_seed_4',
    n5: 'n_seed_5',
    n6: 'n_seed_6',
    n7: 'n_seed_7',
    n8: 'n_seed_8'
  }
  const mk = (id: string, x: number, y: number, angleConstraint: number | null = null) => ({
    id,
    x,
    y,
    angleConstraint,
    angleTolerance: 8
  })
  return {
    version: 1,
    intersections: [
      mk(ids.n1, 140, 520, 0),
      mk(ids.n2, 360, 520, 0),
      mk(ids.n3, 600, 520, 0),
      mk(ids.n4, 860, 520, 0),
      mk(ids.n5, 360, 300, 90),
      mk(ids.n6, 600, 300, 90),
      mk(ids.n7, 600, 740),
      mk(ids.n8, 200, 740)
    ],
    roads: [
      { id: 'r_main', widthLevel: 'primary', material: MATERIALS.asphalt.id },
      { id: 'r_branch', widthLevel: 'secondary', material: MATERIALS.concrete.id },
      { id: 'r_side', widthLevel: 'secondary', material: MATERIALS.cobble.id }
    ],
    edges: [
      { id: 'e1', a: ids.n1, b: ids.n2, roadId: 'r_main' },
      { id: 'e2', a: ids.n2, b: ids.n3, roadId: 'r_main' },
      { id: 'e3', a: ids.n3, b: ids.n4, roadId: 'r_main' },
      { id: 'e4', a: ids.n5, b: ids.n2, roadId: 'r_branch' },
      { id: 'e5', a: ids.n6, b: ids.n3, roadId: 'r_branch' },
      { id: 'e6', a: ids.n5, b: ids.n6, roadId: 'r_branch' },
      { id: 'e7', a: ids.n3, b: ids.n7, roadId: 'r_side' },
      { id: 'e8', a: ids.n7, b: ids.n8, roadId: 'r_side' },
      { id: 'e9', a: ids.n8, b: ids.n1, roadId: 'r_side' }
    ]
  }
}
