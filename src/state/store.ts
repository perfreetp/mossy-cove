import { reactive, watch } from 'vue'
import type { Building, ProjectSnapshot, Settings, Street } from '../types'
import { createSeedProject, createBuildingFromDef } from '../data/seed'
import { BUILDING_DEF_MAP } from '../data/library'
import { obbAABB, streetPlacementPose, uid, distance2D, snapToGrid } from '../utils/geometry'

const STORAGE_KEY = 'mini-sandbox-planner:v1'

export type ToolMode = 'select' | 'street'

interface PersistedDocument extends ProjectSnapshot {
  settings: Settings
  savedAt: string
}

function defaultSettings(): Settings {
  return {
    gridSize: 0.5,
    snapThreshold: 1.6,
    showGrid: true,
    showStreetLabels: true,
    autoStreetAlign: true
  }
}

function loadInitial(): PersistedDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedDocument
    if (!Array.isArray(parsed.buildings) || !Array.isArray(parsed.streets)) return null
    return parsed
  } catch (error) {
    console.warn('无法读取浏览器存档，将使用示例沙盘。', error)
    return null
  }
}

const persisted = loadInitial()
const seed = persisted ? null : createSeedProject()

export const store = reactive({
  buildings: persisted?.buildings ?? seed!.buildings,
  streets: persisted?.streets ?? seed!.streets,
  settings: { ...defaultSettings(), ...(persisted?.settings ?? {}) },
  selectedIds: [] as string[],
  activeTool: 'select' as ToolMode,
  activeStreetId: (persisted ? (persisted.streets[0]?.id ?? null) : 'street-main') as string | null,
  drawingStreet: false,
  revision: 0,
  saveState: persisted ? '已从浏览器恢复' : '示例沙盘已自动保存',
  lastSavedAt: persisted?.savedAt ? new Date(persisted.savedAt) : new Date()
})

export const historyState = reactive({
  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: ''
})

interface HistoryEntry {
  label: string
  before: ProjectSnapshot
  after: ProjectSnapshot
}

export interface Transaction {
  label: string
  before: ProjectSnapshot
}

const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
const HISTORY_LIMIT = 120
let saveTimer: ReturnType<typeof setTimeout> | null = null

function cloneSnapshot(source?: ProjectSnapshot): ProjectSnapshot {
  return JSON.parse(JSON.stringify(source ?? { buildings: store.buildings, streets: store.streets })) as ProjectSnapshot
}

function refreshHistoryState() {
  historyState.canUndo = undoStack.length > 0
  historyState.canRedo = redoStack.length > 0
  historyState.undoLabel = undoStack[undoStack.length - 1]?.label ?? ''
  historyState.redoLabel = redoStack[redoStack.length - 1]?.label ?? ''
}

export function persistNow() {
  try {
    const payload: PersistedDocument = {
      buildings: store.buildings,
      streets: store.streets,
      settings: store.settings,
      savedAt: new Date().toISOString()
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    store.saveState = '已保存到浏览器'
    store.lastSavedAt = new Date()
  } catch (error) {
    store.saveState = '保存失败：浏览器存储不可用'
    console.error(error)
  }
}

function schedulePersist() {
  store.saveState = '保存中…'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 250)
}

watch(
  () => [store.buildings, store.streets, store.settings],
  () => schedulePersist(),
  { deep: true }
)

// Persist the first-run seed immediately so the “stored in this browser” promise holds.
persistNow()

function restoreSnapshot(snapshot: ProjectSnapshot) {
  const data = cloneSnapshot(snapshot)
  store.buildings = data.buildings
  store.streets = data.streets
  const ids = new Set(store.buildings.map((b) => b.id))
  store.selectedIds = store.selectedIds.filter((id) => ids.has(id))
  if (store.activeStreetId && !store.streets.some((s) => s.id === store.activeStreetId)) {
    store.activeStreetId = store.streets[0]?.id ?? null
  }
}

export function beginTransaction(label: string): Transaction {
  return { label, before: cloneSnapshot() }
}

export function commitTransaction(tx: Transaction) {
  const after = cloneSnapshot()
  const beforeText = JSON.stringify(tx.before)
  const afterText = JSON.stringify(after)
  if (beforeText === afterText) return

  undoStack.push({ label: tx.label, before: tx.before, after })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
  store.revision++
  refreshHistoryState()
  schedulePersist()
}

export function rollbackTransaction(tx: Transaction) {
  restoreSnapshot(tx.before)
}

export function runCommand<T>(label: string, fn: () => T): T {
  const tx = beginTransaction(label)
  const result = fn()
  commitTransaction(tx)
  return result
}

export function undo() {
  const entry = undoStack.pop()
  if (!entry) return
  redoStack.push(entry)
  restoreSnapshot(entry.before)
  store.revision++
  refreshHistoryState()
  schedulePersist()
}

export function redo() {
  const entry = redoStack.pop()
  if (!entry) return
  undoStack.push(entry)
  restoreSnapshot(entry.after)
  store.revision++
  refreshHistoryState()
  schedulePersist()
}

export function setSelection(ids: string[]) {
  store.selectedIds = Array.from(new Set(ids))
}

export function toggleSelection(id: string) {
  if (store.selectedIds.includes(id)) {
    store.selectedIds = store.selectedIds.filter((x) => x !== id)
  } else {
    store.selectedIds = [...store.selectedIds, id]
  }
}

export function clearSelection() {
  store.selectedIds = []
}

export function getSelectedBuildings(): Building[] {
  const ids = new Set(store.selectedIds)
  return store.buildings.filter((b) => ids.has(b.id))
}

export function addBuildingFromDefId(
  defId: string,
  x: number,
  z: number,
  rotation = 0,
  patch: Partial<Omit<Building, 'id' | 'defId'>> = {}
): Building | null {
  const def = BUILDING_DEF_MAP.get(defId)
  if (!def) return null
  const building = createBuildingFromDef(def, x, z, rotation)
  Object.assign(building, patch)
  building.x = x
  building.z = z
  building.rotation = rotation
  runCommand('放置建筑', () => {
    store.buildings.push(building)
    setSelection([building.id])
  })
  return building
}

export function deleteSelected() {
  if (!store.selectedIds.length) return
  const ids = new Set(store.selectedIds)
  runCommand(store.selectedIds.length > 1 ? '删除多个建筑' : '删除建筑', () => {
    store.buildings = store.buildings.filter((b) => !ids.has(b.id))
    store.selectedIds = []
  })
}

export function duplicateSelected() {
  const selected = getSelectedBuildings()
  if (!selected.length) return
  runCommand('复制建筑', () => {
    const copies = selected.map((b) => {
      const copy = JSON.parse(JSON.stringify(b)) as Building
      copy.id = uid('b')
      copy.x += 2
      copy.z += 2
      copy.streetId = null
      copy.streetSide = null
      copy.streetU = null
      return copy
    })
    store.buildings.push(...copies)
    setSelection(copies.map((b) => b.id))
  })
}

export function setSelectedRoof(roof: Building['roof']) {
  const selected = getSelectedBuildings()
  if (!selected.length) return
  runCommand('替换屋顶样式', () => {
    const ids = new Set(store.selectedIds)
    for (const b of store.buildings) {
      if (ids.has(b.id)) b.roof = roof
    }
  })
}

export function setSelectedRotation(rotation: number, label = '旋转建筑') {
  if (!store.selectedIds.length) return
  runCommand(label, () => {
    const ids = new Set(store.selectedIds)
    for (const b of store.buildings) {
      if (ids.has(b.id)) {
        b.rotation = rotation
        b.streetId = null
        b.streetSide = null
        b.streetU = null
      }
    }
  })
}

export function rotateSelectedBy(stepRad: number) {
  const selected = getSelectedBuildings()
  if (!selected.length) return
  runCommand('旋转建筑', () => {
    const ids = new Set(store.selectedIds)
    for (const b of store.buildings) {
      if (ids.has(b.id)) {
        b.rotation += stepRad
        b.streetId = null
        b.streetSide = null
        b.streetU = null
      }
    }
  })
}

type AlignAxis = 'x' | 'z'
type AlignEdge = 'min' | 'center' | 'max'

export function alignSelected(axis: AlignAxis, edge: AlignEdge) {
  const selected = getSelectedBuildings()
  if (selected.length < 2) return
  runCommand('对齐建筑', () => {
    const bounds = selected.map((b) => ({ b, box: obbAABB(b) }))
    let target: number
    if (axis === 'x') {
      target = edge === 'min' ? Math.min(...bounds.map((q) => q.box.minX)) : edge === 'max' ? Math.max(...bounds.map((q) => q.box.maxX)) : bounds.reduce((sum, q) => sum + q.b.x, 0) / bounds.length
      for (const { b, box } of bounds) {
        if (edge === 'min') b.x += target - box.minX
        else if (edge === 'max') b.x += target - box.maxX
        else b.x = target
      }
    } else {
      target = edge === 'min' ? Math.min(...bounds.map((q) => q.box.minZ)) : edge === 'max' ? Math.max(...bounds.map((q) => q.box.maxZ)) : bounds.reduce((sum, q) => sum + q.b.z, 0) / bounds.length
      for (const { b, box } of bounds) {
        if (edge === 'min') b.z += target - box.minZ
        else if (edge === 'max') b.z += target - box.maxZ
        else b.z = target
      }
    }
  })
}

export function distributeSelected(axis: AlignAxis) {
  const selected = getSelectedBuildings()
  if (selected.length < 3) return
  runCommand('等距分布建筑', () => {
    const items = selected
      .map((b) => ({ b, box: obbAABB(b) }))
      .sort((a, c) => (axis === 'x' ? a.b.x - c.b.x : a.b.z - c.b.z))

    const first = items[0]
    const last = items[items.length - 1]
    if (axis === 'x') {
      const start = first.box.minX
      const end = last.box.maxX
      const totalWidth = items.reduce((sum, item) => sum + item.box.halfX * 2, 0)
      let gap = (end - start - totalWidth) / (items.length - 1)
      if (!Number.isFinite(gap) || gap < 0) {
        const step = (last.b.x - first.b.x) / (items.length - 1)
        items.forEach((item, i) => (item.b.x = first.b.x + step * i))
        return
      }
      let cursor = start
      items.forEach((item) => {
        item.b.x = cursor + item.box.halfX
        cursor += item.box.halfX * 2 + gap
      })
    } else {
      const start = first.box.minZ
      const end = last.box.maxZ
      const totalDepth = items.reduce((sum, item) => sum + item.box.halfZ * 2, 0)
      let gap = (end - start - totalDepth) / (items.length - 1)
      if (!Number.isFinite(gap) || gap < 0) {
        const step = (last.b.z - first.b.z) / (items.length - 1)
        items.forEach((item, i) => (item.b.z = first.b.z + step * i))
        return
      }
      let cursor = start
      items.forEach((item) => {
        item.b.z = cursor + item.box.halfZ
        cursor += item.box.halfZ * 2 + gap
      })
    }
  })
}

export function unifySelectedOrientation(referenceRotation?: number) {
  const selected = getSelectedBuildings()
  if (selected.length < 2) return
  const rotation = referenceRotation ?? selected[0].rotation
  runCommand('统一朝向', () => {
    const ids = new Set(store.selectedIds)
    for (const b of store.buildings) {
      if (ids.has(b.id)) {
        b.rotation = rotation
        b.streetId = null
        b.streetSide = null
        b.streetU = null
      }
    }
  })
}

export function relayoutStreetBuildings(streetId: string) {
  const street = store.streets.find((s) => s.id === streetId)
  if (!street || street.points.length < 2) return
  for (const b of store.buildings) {
    if (b.streetId !== streetId || b.streetSide == null || b.streetU == null) continue
    const pose = streetPlacementPose(street, b.streetU, b.streetSide, b.depth)
    b.x = pose.x
    b.z = pose.z
    b.rotation = pose.rotation
  }
}

export function createStreet(): Street {
  const street: Street = {
    id: uid('street'),
    name: `街道 ${store.streets.length + 1}`,
    points: [],
    width: 5,
    setback: 2.2,
    color: '#475569'
  }
  store.streets.push(street)
  store.activeStreetId = street.id
  store.activeTool = 'street'
  store.drawingStreet = true
  return street
}

let streetDrawTransaction: Transaction | null = null

export function beginStreetDrawing(): Street {
  if (streetDrawTransaction) cancelStreetDrawing()
  streetDrawTransaction = beginTransaction('绘制街道')
  return createStreet()
}

export function addStreetDrawingPoint(x: number, z: number) {
  const street = store.streets.find((s) => s.id === store.activeStreetId)
  if (!street || !store.drawingStreet) return
  street.points.push({ x: snapToGrid(x, store.settings.gridSize), z: snapToGrid(z, store.settings.gridSize) })
  store.revision++
}

export function finishStreetDrawing() {
  const tx = streetDrawTransaction
  streetDrawTransaction = null
  const street = store.streets.find((s) => s.id === store.activeStreetId)

  if (street && street.points.length >= 3) {
    const last = street.points[street.points.length - 1]
    const previous = street.points[street.points.length - 2]
    if (distance2D(last, previous) < 0.75) street.points.pop()
  }

  if (tx) {
    if (street && street.points.length >= 2) commitTransaction(tx)
    else rollbackTransaction(tx)
  }
  store.drawingStreet = false
  store.activeTool = 'select'
  store.revision++
}

export function cancelStreetDrawing() {
  const tx = streetDrawTransaction
  streetDrawTransaction = null
  if (tx) rollbackTransaction(tx)
  store.drawingStreet = false
  store.activeTool = 'select'
  store.revision++
}

export function deleteStreet(streetId: string) {
  runCommand('删除街道', () => {
    store.streets = store.streets.filter((s) => s.id !== streetId)
    for (const b of store.buildings) {
      if (b.streetId === streetId) {
        b.streetId = null
        b.streetSide = null
        b.streetU = null
      }
    }
    if (store.activeStreetId === streetId) store.activeStreetId = store.streets[0]?.id ?? null
  })
}

export function loadProjectSnapshot(snapshot: ProjectSnapshot, label = '导入项目') {
  runCommand(label, () => {
    restoreSnapshot(snapshot)
    store.selectedIds = []
  })
}

export function resetToSeed() {
  const project = createSeedProject()
  runCommand('恢复示例沙盘', () => {
    restoreSnapshot(project)
    store.selectedIds = []
    store.activeStreetId = project.streets[0]?.id ?? null
  })
}

export function clearScene() {
  runCommand('清空场景', () => {
    store.buildings = []
    store.streets = []
    store.selectedIds = []
    store.activeStreetId = null
    store.drawingStreet = false
  })
}

export function countInTargetRange(): boolean {
  return store.buildings.length >= 60 && store.buildings.length <= 120
}
