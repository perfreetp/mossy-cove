import type { BoothModel, FaceDef, LaidFace, Rect, Vec3 } from '../types'

type Vec2 = [number, number]

interface BoxSpec {
  id: string
  name: string
  group: string
  bottom: number
  cx: number
  cz: number
  width: number
  height: number
  depth: number
}

interface BoothConfig {
  id: string
  name: string
  tagline: string
  description: string
  polygon: Vec2[]
  height: number
  panelWidth: number
  topCellWidth: number
  topCellDepth: number
  boxes: BoxSpec[]
}

function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function polygonBounds(polygon: Vec2[]) {
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function wallFaces(polygon: Vec2[], height: number, targetPanelWidth: number): FaceDef[] {
  const faces: FaceDef[] = []
  const gap = 5

  polygon.forEach((p0, edgeIndex) => {
    const p1 = polygon[(edgeIndex + 1) % polygon.length]
    const dx = p1[0] - p0[0]
    const dz = p1[1] - p0[1]
    const length = Math.hypot(dx, dz)
    const ux = dx / length
    const uz = dz / length
    // Polygon footprints are counter-clockwise in the x/z plan axes.
    const normal: Vec3 = [uz, 0, -ux]
    const right: Vec3 = [normal[2], 0, -normal[0]]
    const forwardDotRight = ux * right[0] + uz * right[2]
    const count = Math.max(1, Math.round(length / targetPanelWidth))
    const cell = length / count

    const pointAt = (distance: number, y: number): Vec3 => [
      p0[0] + ux * distance + normal[0] * 0.35,
      y,
      p0[1] + uz * distance + normal[2] * 0.35,
    ]

    for (let i = 0; i < count; i++) {
      const a = i * cell + gap / 2
      const b = (i + 1) * cell - gap / 2
      const leftDistance = forwardDotRight >= 0 ? a : b
      const rightDistance = forwardDotRight >= 0 ? b : a
      const faceWidth = b - a
      const id = `wall-e${edgeIndex + 1}-p${i + 1}`
      faces.push({
        id,
        name: `墙面板 ${edgeIndex + 1}-${i + 1}`,
        group: '立面墙板',
        kind: 'wall',
        width: faceWidth,
        height,
        corners: [
          pointAt(leftDistance, height),
          pointAt(rightDistance, height),
          pointAt(rightDistance, 0),
          pointAt(leftDistance, 0),
        ],
        normal,
        textAllowed: faceWidth >= 110 && height >= 120,
      })
    }
  })

  return faces
}

function topFaces(polygon: Vec2[], height: number, cellWidth: number, cellDepth: number): FaceDef[] {
  const bounds = polygonBounds(polygon)
  const totalWidth = bounds.maxX - bounds.minX
  const totalDepth = bounds.maxZ - bounds.minZ
  const countX = Math.max(1, Math.round(totalWidth / cellWidth))
  const countZ = Math.max(1, Math.round(totalDepth / cellDepth))
  const stepX = totalWidth / countX
  const stepZ = totalDepth / countZ
  const faces: FaceDef[] = []

  for (let ix = 0; ix < countX; ix++) {
    for (let iz = 0; iz < countZ; iz++) {
      const x0 = bounds.minX + ix * stepX + 2
      const x1 = bounds.minX + (ix + 1) * stepX - 2
      const z0 = bounds.minZ + iz * stepZ + 2
      const z1 = bounds.minZ + (iz + 1) * stepZ - 2
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const valid =
        pointInPolygon(cx, cz, polygon) &&
        pointInPolygon(x0 + 1, z0 + 1, polygon) &&
        pointInPolygon(x1 - 1, z0 + 1, polygon) &&
        pointInPolygon(x1 - 1, z1 - 1, polygon) &&
        pointInPolygon(x0 + 1, z1 - 1, polygon)
      if (!valid) continue

      faces.push({
        id: `top-${ix + 1}-${iz + 1}`,
        name: `顶面 ${ix + 1}-${iz + 1}`,
        group: '顶面模块',
        kind: 'top',
        width: x1 - x0,
        height: z1 - z0,
        corners: [
          [x0, height, z0],
          [x1, height, z0],
          [x1, height, z1],
          [x0, height, z1],
        ],
        normal: [0, 1, 0],
        textAllowed: false,
      })
    }
  }
  return faces
}

function boxFaces(box: BoxSpec): FaceDef[] {
  const { cx, cz, width: w, height: h, depth: d, bottom } = box
  const y0 = bottom
  const y1 = bottom + h
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const z0 = cz - d / 2
  const z1 = cz + d / 2
  const prefix = box.id
  const common = { group: box.group }

  const make = (
    suffix: string,
    name: string,
    kind: FaceDef['kind'],
    width: number,
    height: number,
    corners: FaceDef['corners'],
    normal: Vec3,
    textAllowed = false,
  ): FaceDef => ({ id: `${prefix}-${suffix}`, name: `${box.name} · ${name}`, kind, width, height, corners, normal, textAllowed, ...common })

  return [
    make('front', '正面', 'counter', w, h, [
      [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1],
    ], [0, 0, 1], w >= 100 && h >= 45),
    make('back', '背面', 'counter', w, h, [
      [x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0],
    ], [0, 0, -1]),
    make('right', '右侧', 'counter', d, h, [
      [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1],
    ], [1, 0, 0], d >= 100 && h >= 45),
    make('left', '左侧', 'counter', d, h, [
      [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0],
    ], [-1, 0, 0], d >= 100 && h >= 45),
    make('top', '台面', 'top', w, d, [
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ], [0, 1, 0]),
  ]
}

function layoutFaces(faces: FaceDef[]): { faces: LaidFace[]; sheet: BoothModel['sheet'] } {
  const pad = 72
  const gapX = 38
  const gapY = 62
  const labelSpace = 30
  const maxRowWidth = 2360
  let x = pad
  let rowTop = pad
  let rowHeight = 0
  let maxRight = 0

  const laid: LaidFace[] = faces.map((face) => {
    if (x > pad && x + face.width > pad + maxRowWidth) {
      x = pad
      rowTop += rowHeight + gapY
      rowHeight = 0
    }

    const rect: Rect = { x, y: rowTop + labelSpace, width: face.width, height: face.height }
    rowHeight = Math.max(rowHeight, face.height + labelSpace)
    maxRight = Math.max(maxRight, x + face.width)
    x += face.width + gapX
    return { ...face, rect }
  })

  return {
    faces: laid,
    sheet: { width: Math.max(1200, maxRight + pad), height: rowTop + rowHeight + pad },
  }
}

function createModel(config: BoothConfig): BoothModel {
  const bounds = polygonBounds(config.polygon)
  const faces = [
    ...wallFaces(config.polygon, config.height, config.panelWidth),
    ...topFaces(config.polygon, config.height + 1, config.topCellWidth, config.topCellDepth),
    ...config.boxes.flatMap(boxFaces),
  ]
  const laid = layoutFaces(faces)
  return {
    id: config.id,
    name: config.name,
    tagline: config.tagline,
    description: config.description,
    width: bounds.maxX - bounds.minX,
    depth: bounds.maxZ - bounds.minZ,
    height: config.height,
    faceCount: laid.faces.length,
    textFaceCount: laid.faces.filter((f) => f.textAllowed).length,
    ...laid,
  }
}

const rectPoly = (width: number, depth: number): Vec2[] => [
  [-width / 2, -depth / 2],
  [width / 2, -depth / 2],
  [width / 2, depth / 2],
  [-width / 2, depth / 2],
]

export const BOOTH_MODELS: BoothModel[] = [
  createModel({
    id: 'aurora-linear',
    name: '星轨线性展台',
    tagline: '6×3m · 新品发布标准阵列',
    description: '长边品牌墙、连续顶面模块与双接待台，适合发布会签到与产品陈列。',
    polygon: rectPoly(620, 340),
    height: 350,
    panelWidth: 150,
    topCellWidth: 155,
    topCellDepth: 160,
    boxes: [
      { id: 'counter-a', name: '左接待台', group: '接待台', bottom: 0, cx: -150, cz: 78, width: 220, height: 105, depth: 72 },
      { id: 'counter-b', name: '右接待台', group: '接待台', bottom: 0, cx: 150, cz: 78, width: 220, height: 105, depth: 72 },
      { id: 'plinth-a', name: '展品台 A', group: '展品台', bottom: 0, cx: -185, cz: -55, width: 110, height: 92, depth: 110 },
      { id: 'plinth-b', name: '展品台 B', group: '展品台', bottom: 0, cx: 185, cz: -55, width: 110, height: 92, depth: 110 },
    ],
  }),
  createModel({
    id: 'nebula-l',
    name: '星云 L 形转角展台',
    tagline: '8×6m · 双面开放动线',
    description: 'L 形品牌界面形成转角焦点，顶面随多边形裁切，适合沉浸式发布体验。',
    polygon: [
      [-410, -300], [410, -300], [410, 70], [-120, 70],
      [-120, 310], [-410, 310],
    ],
    height: 390,
    panelWidth: 155,
    topCellWidth: 165,
    topCellDepth: 155,
    boxes: [
      { id: 'counter-corner', name: '转角吧台', group: '接待台', bottom: 0, cx: 150, cz: 175, width: 260, height: 110, depth: 78 },
      { id: 'plinth-c', name: '旗舰展品台', group: '展品台', bottom: 0, cx: -260, cz: -100, width: 150, height: 105, depth: 130 },
      { id: 'tower-a', name: '品牌柱', group: '品牌柱', bottom: 0, cx: 285, cz: -160, width: 82, height: 300, depth: 82 },
    ],
  }),
  createModel({
    id: 'summit-island',
    name: '巅峰岛台展台',
    tagline: '9×6.4m · 四面环绕曝光',
    description: '四周连续立面与网格化吊顶，中央组合展柜，适合大型发布会主展台。',
    polygon: rectPoly(900, 640),
    height: 420,
    panelWidth: 165,
    topCellWidth: 150,
    topCellDepth: 160,
    boxes: [
      { id: 'island-counter', name: '中央岛台', group: '中央展柜', bottom: 0, cx: 0, cz: 40, width: 300, height: 112, depth: 150 },
      { id: 'plinth-l', name: '左展品台', group: '展品台', bottom: 0, cx: -260, cz: -120, width: 130, height: 96, depth: 130 },
      { id: 'plinth-r', name: '右展品台', group: '展品台', bottom: 0, cx: 260, cz: -120, width: 130, height: 96, depth: 130 },
      { id: 'tower-l', name: '左发光柱', group: '品牌柱', bottom: 0, cx: -360, cz: 0, width: 76, height: 330, depth: 76 },
      { id: 'tower-r', name: '右发光柱', group: '品牌柱', bottom: 0, cx: 360, cz: 0, width: 76, height: 330, depth: 76 },
    ],
  }),
  createModel({
    id: 'horizon-t',
    name: '视界 T 台展台',
    tagline: '7.6×7m · 走秀与演讲复合',
    description: 'T 形伸展界面强化发布动线，长向立面适合重复品牌阵列与灯光氛围。',
    polygon: [
      [-380, -320], [380, -320], [380, -80], [160, -80],
      [160, 380], [-160, 380], [-160, -80], [-380, -80],
    ],
    height: 370,
    panelWidth: 150,
    topCellWidth: 160,
    topCellDepth: 150,
    boxes: [
      { id: 'stage-counter', name: '发布控制台', group: '功能台', bottom: 0, cx: 0, cz: -205, width: 280, height: 100, depth: 82 },
      { id: 'runway-plinth', name: 'T 台基座', group: '舞台', bottom: 0, cx: 0, cz: 150, width: 280, height: 38, depth: 430 },
      { id: 'speaker-l', name: '左演讲台', group: '功能台', bottom: 0, cx: -245, cz: 40, width: 90, height: 118, depth: 70 },
      { id: 'speaker-r', name: '右演讲台', group: '功能台', bottom: 0, cx: 245, cz: 40, width: 90, height: 118, depth: 70 },
    ],
  }),
]

export const modelMap = new Map(BOOTH_MODELS.map((m) => [m.id, m]))

export function getModel(id: string): BoothModel {
  return modelMap.get(id) ?? BOOTH_MODELS[0]
}
