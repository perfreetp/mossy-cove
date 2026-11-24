import type { BuildingCategory, BuildingDef, RoofStyle } from '../types'

type TierSpec = [number, number, number, string]

const residential: TierSpec[] = [
  [4, 4, 4, '庭院小屋'],
  [4.5, 4, 5, '单层住宅'],
  [5, 4.5, 6, '双坡民居'],
  [5, 5, 7.5, '联排住宅'],
  [6, 5, 8.5, '街角公寓'],
  [6, 5.5, 9.5, '花园住宅'],
  [7, 6, 11, '板式公寓'],
  [7.5, 6, 12.5, '围合住宅'],
  [8, 7, 14, '社区公寓'],
  [9, 7, 16, '顶层复式']
]

const towers: TierSpec[] = [
  [4, 4, 18, '星光塔楼'],
  [4.5, 4.5, 22, '商务小楼'],
  [5, 5, 26, '中央塔楼'],
  [5, 5.5, 30, '滨江塔楼'],
  [6, 6, 34, '金融大厦'],
  [6.5, 6, 39, '云端公寓'],
  [7, 7, 44, '环球中心'],
  [7, 7.5, 50, '翡翠塔'],
  [8, 8, 56, '地标双塔'],
  [9, 9, 64, '天际总部']
]

const warehouses: TierSpec[] = [
  [8, 6, 5, '小型仓房'],
  [9, 6.5, 6, '街区仓库'],
  [10, 7, 6.5, '轻钢仓'],
  [11, 8, 7.5, '物流仓'],
  [12, 8, 8, '储运中心'],
  [13, 9, 9, '临港仓'],
  [14, 10, 9.5, '大型库房'],
  [16, 10, 10.5, '转运中心'],
  [18, 12, 11.5, '仓储基地'],
  [20, 12, 13, '超级仓城']
]

const palette: Record<BuildingCategory, string[]> = {
  residential: ['#f2c9a0', '#e8b48c', '#f0d7b5', '#d9a07d', '#e6c29a'],
  tower: ['#9fc4d8', '#86aecb', '#b7cedd', '#7f9fbd', '#a9bdd6'],
  warehouse: ['#b8b0a2', '#a7b0aa', '#c7b89d', '#9aa7a8', '#b6a58d']
}

const defaultRoof: Record<BuildingCategory, RoofStyle> = {
  residential: 'gable',
  tower: 'flat',
  warehouse: 'hip'
}

function makeCategory(category: BuildingCategory, label: string, specs: TierSpec[]): BuildingDef[] {
  return specs.map(([width, depth, height, name], index) => ({
    defId: `${category}-${index + 1}`,
    category,
    tier: index + 1,
    tierName: `T${index + 1}`,
    name: `${label} · ${name}`,
    width,
    depth,
    height,
    color: palette[category][index % palette[category].length],
    roof: defaultRoof[category]
  }))
}

export const BUILDING_DEFS: BuildingDef[] = [
  ...makeCategory('residential', '住宅', residential),
  ...makeCategory('tower', '塔楼', towers),
  ...makeCategory('warehouse', '仓房', warehouses)
]

export const BUILDING_DEF_MAP = new Map(BUILDING_DEFS.map((def) => [def.defId, def]))

export const CATEGORY_META: Record<BuildingCategory, { label: string; hint: string; color: string }> = {
  residential: { label: '住宅', hint: '4–9 面宽 · 低层到中层', color: '#d98b5f' },
  tower: { label: '塔楼', hint: '4–9 基座 · 18–64 高度', color: '#5f8fb8' },
  warehouse: { label: '仓房', hint: '8–20 大跨体块', color: '#8a8172' }
}

export const ROOF_LABELS: Record<RoofStyle, string> = {
  flat: '平屋顶',
  gable: '双坡顶',
  hip: '四坡顶'
}
