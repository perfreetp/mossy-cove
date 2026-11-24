import { markRaw, reactive, ref, watch } from 'vue'
import { Viewer } from '../three/Viewer'
import {
  createContourExtrusion,
  createSampleOrganData,
  getBounds,
  readMeshFile,
  signedVolumeMm3,
  simplifyMeshData,
} from '../lib/geometry'
import { manifoldEngine } from '../lib/manifold-engine'
import { computeSectionOutline } from '../lib/section'
import { idbGet, idbSet } from '../lib/storage'
import { downloadJson, meshFromBase64, meshToBase64, validateProjectFile } from '../lib/serialization'
import type {
  ControlPoint,
  Lesion,
  MeshGeometryData,
  ModuleTab,
  ProjectFile,
  ProjectFileMesh,
  SectionState,
  SimplifyLevel,
  Toast,
  Vec3Tuple,
  ViewMode,
} from '../lib/types'

const LESION_COLORS = ['#f43f5e', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#eab308', '#ec4899', '#84cc16']

interface PersistedOrgan {
  name: string
  format: string
  simplifyLevel: SimplifyLevel
  originalFaceCount: number
  original: MeshGeometryData
}

interface PersistedLesion extends Omit<Lesion, 'geometry' | 'occupiedGeometry'> {
  geometry: MeshGeometryData | null
  occupiedGeometry: MeshGeometryData | null
}

interface PersistedProject {
  app: 'ct-mri-lesion-studio'
  formatVersion: 1
  savedAt: string
  organ: PersistedOrgan | null
  lesions: PersistedLesion[]
  thresholdMl: number
  section: Pick<SectionState, 'enabled' | 'normal' | 'position' | 'flip'>
  viewMode: ViewMode
  activeLesionId: string | null
  booleanTargetId: string | null
  booleanToolId: string | null
  keepBooleanOperand: boolean
  drawThickness: number
  drawSmoothing: number
}

function createInitialState() {
  return {
    engineStatus: 'loading' as 'loading' | 'ready' | 'error',
    engineMessage: '正在加载 Manifold WASM…',
    activeTab: 'load' as ModuleTab,
    drawMode: false,
    organ: {
      status: 'empty' as 'empty' | 'loading' | 'ready' | 'error',
      busy: false,
      name: '',
      format: '',
      error: '',
      original: null as MeshGeometryData | null,
      geometry: null as MeshGeometryData | null,
      simplifyLevel: 0 as SimplifyLevel,
      originalFaceCount: 0,
      faceCount: 0,
      vertexCount: 0,
      size: [0, 0, 0] as Vec3Tuple,
      min: [0, 0, 0] as Vec3Tuple,
      max: [0, 0, 0] as Vec3Tuple,
      volumeMm3: null as number | null,
      csgStatus: '尚未建立',
      csgSource: '—',
    },
    lesions: [] as Lesion[],
    activeLesionId: null as string | null,
    booleanTargetId: null as string | null,
    booleanToolId: null as string | null,
    keepBooleanOperand: false,
    draftPoints: [] as ControlPoint[],
    drawThickness: 12,
    drawSmoothing: 1,
    thresholdMl: 2,
    viewMode: 'all' as ViewMode,
    section: {
      enabled: false,
      active: false,
      normal: [1, 0, 0] as Vec3Tuple,
      position: 0,
      flip: false,
      organAreaMm2: null,
      dragging: false,
    } as SectionState,
    toasts: [] as Toast[],
  }
}

export const state = reactive(createInitialState())
export const saveStatus = ref<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
export const lastSavedAt = ref<number | null>(null)

let viewer: Viewer | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let sectionTimer: ReturnType<typeof setTimeout> | null = null
let simplifyToken = 0
const measureTokens = new Map<string, number>()
const rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function uid(prefix = 'lesion'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export function notify(message: string, type: Toast['type'] = 'info', timeout = 3600) {
  const id = uid('toast')
  state.toasts.push({ id, message, type })
  setTimeout(() => dismissToast(id), timeout)
}

export function dismissToast(id: string) {
  const index = state.toasts.findIndex((t) => t.id === id)
  if (index >= 0) state.toasts.splice(index, 1)
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 100000) return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function mm3ToMl(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return value / 1000
}

export function isHighlighted(lesion: Lesion): boolean {
  const volume = lesion.volumeMm3 ?? lesion.rawVolumeMm3
  if (volume === null) return false
  return volume / 1000 > state.thresholdMl
}

export function setActiveTab(tab: ModuleTab) {
  state.activeTab = tab
  state.section.active = tab === 'section'
  viewer?.setSectionInteractive(state.section.active)
  if (tab !== 'draw' && state.drawMode) setDrawMode(false)
  if (tab === 'section') scheduleSectionUpdate(30)
}

export function registerViewer(instance: Viewer) {
  viewer = instance
  syncViewerAll()
}

export async function initializeEngine() {
  try {
    await manifoldEngine.init()
    state.engineStatus = 'ready'
    state.engineMessage = 'Manifold 布尔引擎已就绪'
  } catch (error) {
    console.error(error)
    state.engineStatus = 'error'
    state.engineMessage = `Manifold 初始化失败：${error instanceof Error ? error.message : String(error)}`
    notify(state.engineMessage, 'error', 8000)
  }
}

function styleFor(lesion: Lesion) {
  return {
    color: lesion.color,
    visible: lesion.visible,
    highlighted: isHighlighted(lesion),
    selected: lesion.id === state.activeLesionId,
  }
}

function syncLesionMesh(lesion: Lesion) {
  if (!viewer) return
  const display = lesion.occupiedGeometry ?? lesion.geometry
  viewer.upsertLesion(lesion.id, display, styleFor(lesion))
}

function syncAllStyles() {
  for (const lesion of state.lesions) {
    viewer?.updateLesionStyle(lesion.id, styleFor(lesion))
  }
}

function syncViewerAll() {
  if (!viewer) return
  viewer.setOrgan(state.organ.geometry)
  viewer.frameOrgan()
  for (const lesion of state.lesions) syncLesionMesh(lesion)
  viewer.setDraftPoints(state.draftPoints)
  const active = state.lesions.find((l) => l.id === state.activeLesionId)
  viewer.setContour(active ? active.points : null, active?.color)
  viewer.setViewMode(state.viewMode)
  viewer.setPickEnabled(state.drawMode)
  viewer.setSectionInteractive(state.section.active)
  viewer.setSection(state.section.enabled, state.section.normal, state.section.position, state.section.flip)
  scheduleSectionUpdate(50)
}

export async function loadOrganFile(file: File) {
  if (state.lesions.length > 0 && !window.confirm('载入新器官将清除当前全部病灶与标注，是否继续？')) return
  state.organ.status = 'loading'
  state.organ.error = ''
  try {
    const data = await readMeshFile(file)
    await adoptOrgan(data, file.name, file.name.split('.').pop()?.toUpperCase() ?? 'MESH')
    notify(`已载入 ${file.name}`, 'success')
  } catch (error) {
    console.error(error)
    state.organ.status = 'error'
    state.organ.error = error instanceof Error ? error.message : String(error)
    notify(`模型读取失败：${state.organ.error}`, 'error', 7000)
  }
}

export async function loadSampleOrgan() {
  if (state.lesions.length > 0 && !window.confirm('载入示例器官将清除当前全部病灶，是否继续？')) return
  const data = createSampleOrganData()
  await adoptOrgan(data, '示例_椭球器官.stl', 'SAMPLE')
  notify('已生成闭合示例器官，可直接在表面勾画', 'success')
}

async function adoptOrgan(data: MeshGeometryData, name: string, format: string) {
  const oldLesionIds = state.lesions.map((lesion) => lesion.id)
  state.lesions.splice(0, state.lesions.length)
  for (const id of oldLesionIds) viewer?.removeLesion(id)
  state.activeLesionId = null
  state.booleanTargetId = null
  state.booleanToolId = null
  state.draftPoints = []
  viewer?.setDraftPoints([])
  viewer?.setContour(null)

  const bounds = getBounds(data)
  state.organ.status = 'ready'
  state.organ.busy = false
  state.organ.name = name
  state.organ.format = format
  state.organ.error = ''
  state.organ.original = markRaw(data)
  state.organ.geometry = markRaw(data)
  state.organ.simplifyLevel = 0
  state.organ.originalFaceCount = Math.floor(data.indices.length / 3)
  state.organ.faceCount = state.organ.originalFaceCount
  state.organ.vertexCount = data.positions.length / 3
  state.organ.size = bounds.size
  state.organ.min = bounds.min
  state.organ.max = bounds.max
  state.organ.volumeMm3 = signedVolumeMm3(data)

  const maxSize = Math.max(...bounds.size, 1)
  state.drawThickness = Math.round(THREE_clamp(maxSize * 0.09, 3, 45) * 10) / 10
  state.section.position = 0

  viewer?.setOrgan(data)
  viewer?.frameOrgan()
  viewer?.setSection(state.section.enabled, state.section.normal, 0, state.section.flip)

  configureOrganCsg(data, '原始网格')
  await setSimplifyLevel(2)
}

function THREE_clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function configureOrganCsg(data: MeshGeometryData, source: string) {
  if (state.engineStatus !== 'ready') {
    state.organ.csgStatus = '引擎加载中'
    state.organ.csgSource = source
    return
  }
  try {
    const status = manifoldEngine.setOrgan(data)
    if (status === 'NoError') {
      state.organ.csgStatus = 'NoError（闭合流形）'
      state.organ.csgSource = source
      state.organ.volumeMm3 = manifoldEngine.organVolumeMm3 ?? signedVolumeMm3(data)
    } else {
      state.organ.csgStatus = status
      state.organ.csgSource = `${source}；已使用有符号体积估算`
      state.organ.volumeMm3 = signedVolumeMm3(data)
    }
  } catch (error) {
    state.organ.csgStatus = error instanceof Error ? error.message : String(error)
    state.organ.csgSource = `${source}；布尔功能不可用`
  }
}

export async function setSimplifyLevel(level: SimplifyLevel) {
  const original = state.organ.original
  if (!original) return
  const token = ++simplifyToken
  state.organ.simplifyLevel = level
  state.organ.busy = true
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    const simplified = await simplifyMeshData(original, level)
    if (token !== simplifyToken) return
    state.organ.geometry = markRaw(simplified)
    state.organ.faceCount = Math.floor(simplified.indices.length / 3)
    state.organ.vertexCount = simplified.positions.length / 3
    viewer?.setOrgan(simplified)
    viewer?.setSection(state.section.enabled, state.section.normal, state.section.position, state.section.flip)

    let csgOk = false
    if (state.engineStatus === 'ready') {
      try {
        const status = manifoldEngine.setOrgan(simplified)
        csgOk = status === 'NoError'
        if (csgOk) {
          state.organ.csgStatus = 'NoError（闭合流形）'
          state.organ.csgSource = '当前简化网格'
          state.organ.volumeMm3 = manifoldEngine.organVolumeMm3 ?? signedVolumeMm3(simplified)
        } else {
          state.organ.csgStatus = status
        }
      } catch (error) {
        state.organ.csgStatus = error instanceof Error ? error.message : String(error)
      }
    }

    if (!csgOk && level !== 0) {
      configureOrganCsg(original, '原始网格（简化结果不适合布尔）')
    } else if (!csgOk) {
      state.organ.csgSource = '原始网格；已使用有符号体积估算'
      state.organ.volumeMm3 = signedVolumeMm3(original)
    }

    await remeasureAll()
    scheduleSectionUpdate(0)
  } finally {
    if (token === simplifyToken) state.organ.busy = false
  }
}

export function setDrawMode(enabled: boolean) {
  state.drawMode = enabled
  viewer?.setPickEnabled(enabled)
  if (enabled) {
    state.activeTab = 'draw'
    state.section.active = false
    viewer?.setSectionInteractive(false)
  }
}

export function addDraftPoint(position: Vec3Tuple, normal: Vec3Tuple) {
  if (!state.drawMode) return
  state.draftPoints.push({ position, normal })
  viewer?.setDraftPoints(state.draftPoints)
}

export function undoDraftPoint() {
  state.draftPoints.pop()
  viewer?.setDraftPoints(state.draftPoints)
}

export function clearDraftPoints() {
  state.draftPoints.splice(0, state.draftPoints.length)
  viewer?.setDraftPoints([])
}

export function startNewContour() {
  state.activeLesionId = null
  state.booleanTargetId = null
  clearDraftPoints()
  setDrawMode(true)
  viewer?.setContour(null)
  syncAllStyles()
}

export async function createLesionFromDraft() {
  if (state.draftPoints.length < 3) {
    notify('至少放置 3 个控制点并闭合区域', 'warning')
    return
  }
  try {
    const geometry = createContourExtrusion(state.draftPoints, state.drawThickness, state.drawSmoothing)
    const lesion: Lesion = {
      id: uid(),
      name: `病灶 ${state.lesions.length + 1}`,
      color: LESION_COLORS[state.lesions.length % LESION_COLORS.length],
      visible: true,
      points: state.draftPoints.map((p) => ({ position: [...p.position] as Vec3Tuple, normal: [...p.normal] as Vec3Tuple })),
      thickness: state.drawThickness,
      smoothing: state.drawSmoothing,
      geometry: markRaw(geometry),
      occupiedGeometry: null,
      rawVolumeMm3: null,
      volumeMm3: null,
      organRatio: null,
      sectionAreaMm2: null,
      measureStatus: 'idle',
      measureMessage: '',
      booleanHistory: [],
      createdAt: Date.now(),
    }
    state.lesions.push(lesion)
    state.activeLesionId = lesion.id
    state.booleanTargetId = lesion.id
    if (!state.booleanToolId) {
      const other = state.lesions.find((l) => l.id !== lesion.id)
      state.booleanToolId = other?.id ?? null
    }
    clearDraftPoints()
    setDrawMode(false)
    viewer?.setContour(lesion.points, lesion.color)
    syncLesionMesh(lesion)
    syncAllStyles()
    await remeasureLesion(lesion.id)
    notify(`${lesion.name} 已生成并完成体积测量`, 'success')
  } catch (error) {
    console.error(error)
    notify(`拉伸失败：${error instanceof Error ? error.message : String(error)}`, 'error')
  }
}

export function selectLesion(id: string | null) {
  state.activeLesionId = id
  if (id) {
    const lesion = state.lesions.find((l) => l.id === id)
    if (lesion) {
      state.drawThickness = lesion.thickness
      state.drawSmoothing = lesion.smoothing
      if (!state.booleanTargetId) state.booleanTargetId = id
      viewer?.setContour(lesion.points, lesion.color)
    }
  } else {
    viewer?.setContour(null)
  }
  syncAllStyles()
}

export function deleteLesion(id: string) {
  const index = state.lesions.findIndex((l) => l.id === id)
  if (index < 0) return
  state.lesions.splice(index, 1)
  viewer?.removeLesion(id)
  if (state.activeLesionId === id) {
    state.activeLesionId = state.lesions[0]?.id ?? null
    const active = state.lesions[0]
    viewer?.setContour(active ? active.points : null, active?.color)
  }
  if (state.booleanTargetId === id) state.booleanTargetId = state.lesions[0]?.id ?? null
  if (state.booleanToolId === id) state.booleanToolId = state.lesions.find((l) => l.id !== state.booleanTargetId)?.id ?? null
  scheduleSectionUpdate(0)
  notify('病灶已删除', 'info', 1800)
}

export function toggleLesionVisibility(id: string) {
  const lesion = state.lesions.find((l) => l.id === id)
  if (!lesion) return
  lesion.visible = !lesion.visible
  syncLesionMesh(lesion)
}

export function setLesionColor(id: string, color: string) {
  const lesion = state.lesions.find((l) => l.id === id)
  if (!lesion) return
  lesion.color = color
  syncLesionMesh(lesion)
  viewer?.setContour(lesion.points, color)
  scheduleSectionUpdate(0)
}

export function queueLesionRebuild(id: string) {
  const lesion = state.lesions.find((l) => l.id === id)
  if (!lesion || lesion.points.length < 3) return
  lesion.thickness = state.drawThickness
  lesion.smoothing = state.drawSmoothing
  state.activeLesionId = id

  const existing = rebuildTimers.get(id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    rebuildTimers.delete(id)
    try {
      const geometry = createContourExtrusion(lesion.points, lesion.thickness, lesion.smoothing)
      lesion.geometry = markRaw(geometry)
      lesion.occupiedGeometry = null
      if (lesion.booleanHistory.length > 0) {
        lesion.booleanHistory = []
        lesion.measureMessage = '参数调整后已按原始轮廓重建'
      }
      syncLesionMesh(lesion)
      await remeasureLesion(id)
    } catch (error) {
      notify(`重建病灶失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, 180)
  rebuildTimers.set(id, timer)
}

export function updateThickness(value: number) {
  state.drawThickness = value
  const active = state.lesions.find((l) => l.id === state.activeLesionId)
  if (active && !state.drawMode) queueLesionRebuild(active.id)
}

export function updateSmoothing(value: number) {
  state.drawSmoothing = value
  const active = state.lesions.find((l) => l.id === state.activeLesionId)
  if (active && !state.drawMode) queueLesionRebuild(active.id)
}

export async function remeasureLesion(id: string) {
  const lesion = state.lesions.find((l) => l.id === id)
  if (!lesion || !lesion.geometry) return
  const token = (measureTokens.get(id) ?? 0) + 1
  measureTokens.set(id, token)
  lesion.measureStatus = 'calculating'
  lesion.measureMessage = '正在与器官求交…'

  try {
    await manifoldEngine.ready()
    const result = await manifoldEngine.measure(lesion.geometry)
    if (measureTokens.get(id) !== token) return

    lesion.rawVolumeMm3 = result.rawVolumeMm3
    if (result.volumeMm3 !== null) {
      lesion.volumeMm3 = result.volumeMm3
      lesion.organRatio =
        result.ratio ??
        (state.organ.volumeMm3 && state.organ.volumeMm3 > 0 ? result.volumeMm3 / state.organ.volumeMm3 : null)
      lesion.occupiedGeometry = result.geometry ? markRaw(result.geometry) : null
    } else {
      lesion.volumeMm3 = result.rawVolumeMm3
      lesion.organRatio = state.organ.volumeMm3 ? result.rawVolumeMm3 / state.organ.volumeMm3 : null
      lesion.occupiedGeometry = null
    }

    if (result.status === 'NoError') {
      lesion.measureStatus = 'ready'
      lesion.measureMessage = lesion.occupiedGeometry ? '已完成器官求交' : '病灶与器官无重叠'
      if (!lesion.occupiedGeometry) lesion.volumeMm3 = 0
    } else if (result.status === 'OrganUnavailable') {
      lesion.measureStatus = 'ready'
      lesion.measureMessage = '器官不是有效流形，暂显示病灶自身体积'
      lesion.organRatio = null
    } else {
      lesion.measureStatus = 'error'
      lesion.measureMessage = `求交状态：${result.status}；显示原始拉伸体积`
      lesion.volumeMm3 = result.rawVolumeMm3
      lesion.organRatio = state.organ.volumeMm3 ? result.rawVolumeMm3 / state.organ.volumeMm3 : null
      lesion.occupiedGeometry = null
    }

    syncLesionMesh(lesion)
    syncAllStyles()
    scheduleSectionUpdate(0)
  } catch (error) {
    if (measureTokens.get(id) !== token) return
    lesion.measureStatus = 'error'
    lesion.measureMessage = error instanceof Error ? error.message : String(error)
    lesion.volumeMm3 = lesion.rawVolumeMm3
    syncLesionMesh(lesion)
  }
}

export async function remeasureAll() {
  for (const lesion of state.lesions) {
    await remeasureLesion(lesion.id)
  }
}

export async function applyBoolean(operation: 'union' | 'difference') {
  const targetId = state.booleanTargetId ?? state.activeLesionId
  const toolId = state.booleanToolId
  const target = state.lesions.find((l) => l.id === targetId)
  const tool = state.lesions.find((l) => l.id === toolId)
  if (!target || !tool) {
    notify('请先选择目标病灶和参与运算的病灶', 'warning')
    return
  }
  if (target.id === tool.id) {
    notify('目标病灶和参与病灶不能是同一个', 'warning')
    return
  }
  if (!target.geometry || !tool.geometry) {
    notify('两个病灶都需要有效网格后才能布尔运算', 'warning')
    return
  }

  try {
    const result = await manifoldEngine.boolean(target.geometry, tool.geometry, operation)
    target.geometry = markRaw(result.geometry)
    target.occupiedGeometry = null
    target.booleanHistory.push(
      `${operation === 'union' ? '合并' : '求差'} ${tool.name} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    )
    state.activeLesionId = target.id
    syncLesionMesh(target)

    if (!state.keepBooleanOperand) {
      deleteLesion(tool.id)
      notify(`已对 ${target.name} 执行${operation === 'union' ? '合并' : '求差'}，参与病灶已移除`, 'success')
    } else {
      notify(`已对 ${target.name} 执行${operation === 'union' ? '合并' : '求差'}`, 'success')
    }
    await remeasureLesion(target.id)
  } catch (error) {
    console.error(error)
    notify(`布尔运算失败：${error instanceof Error ? error.message : String(error)}`, 'error', 7000)
  }
}

export function setViewMode(mode: ViewMode) {
  state.viewMode = mode
  viewer?.setViewMode(mode)
}

export function setThreshold(valueMl: number) {
  state.thresholdMl = Number.isFinite(valueMl) ? valueMl : 0
  syncAllStyles()
}

watch(
  () => state.thresholdMl,
  () => syncAllStyles(),
)

export function setSectionEnabled(enabled: boolean) {
  state.section.enabled = enabled
  if (enabled && state.organ.geometry && Math.abs(state.section.position) < 1e-6) {
    state.section.position = 0
  }
  viewer?.setSection(enabled, state.section.normal, state.section.position, state.section.flip)
  scheduleSectionUpdate(0)
}

export function setSectionNormal(axis: 'x' | 'y' | 'z') {
  state.section.normal =
    axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
  viewer?.setSection(state.section.enabled, state.section.normal, state.section.position, state.section.flip)
  scheduleSectionUpdate(0)
}

export function setSectionPosition(position: number, fromViewer = false) {
  state.section.position = position
  if (!fromViewer) {
    viewer?.setSection(state.section.enabled, state.section.normal, position, state.section.flip)
  } else {
    viewer?.setSection(state.section.enabled, state.section.normal, position, state.section.flip)
  }
  scheduleSectionUpdate(40)
}

export function setSectionFlip(flip: boolean) {
  state.section.flip = flip
  viewer?.setSection(state.section.enabled, state.section.normal, state.section.position, flip)
}

export function handleViewerSectionPosition(position: number) {
  setSectionPosition(position, true)
}

export function handleViewerSectionDrag(dragging: boolean) {
  state.section.dragging = dragging
  if (!dragging) scheduleSave()
}

export function scheduleSectionUpdate(delay = 60) {
  if (sectionTimer) clearTimeout(sectionTimer)
  sectionTimer = setTimeout(() => {
    sectionTimer = null
    updateSectionResults()
  }, delay)
}

function updateSectionResults() {
  if (!viewer) return
  if (!state.section.enabled || !state.organ.geometry) {
    viewer.setOrganOutline(null)
    state.section.organAreaMm2 = null
    for (const lesion of state.lesions) {
      viewer.upsertLesionOutline(lesion.id, lesion.color, null)
      lesion.sectionAreaMm2 = null
    }
    return
  }

  try {
    const organOutline = computeSectionOutline(state.organ.geometry, state.section.normal, state.section.position)
    viewer.setOrganOutline(organOutline.linePositions)
    state.section.organAreaMm2 = organOutline.areaMm2

    for (const lesion of state.lesions) {
      const display = lesion.occupiedGeometry ?? lesion.geometry
      if (!lesion.visible || !display) {
        viewer.upsertLesionOutline(lesion.id, lesion.color, null)
        lesion.sectionAreaMm2 = null
        continue
      }
      const outline = computeSectionOutline(display, state.section.normal, state.section.position)
      lesion.sectionAreaMm2 = outline.areaMm2
      viewer.upsertLesionOutline(
        lesion.id,
        isHighlighted(lesion) ? '#fbbf24' : lesion.color,
        outline.linePositions,
      )
    }
  } catch (error) {
    console.warn('Section update failed', error)
  }
}

function buildPersisted(): PersistedProject {
  return {
    app: 'ct-mri-lesion-studio',
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    organ: state.organ.original
      ? {
          name: state.organ.name,
          format: state.organ.format,
          simplifyLevel: state.organ.simplifyLevel,
          originalFaceCount: state.organ.originalFaceCount,
          original: state.organ.original,
        }
      : null,
    lesions: state.lesions.map((lesion) => ({
      ...lesion,
      points: lesion.points.map((p) => ({
        position: [...p.position] as Vec3Tuple,
        normal: [...p.normal] as Vec3Tuple,
      })),
      booleanHistory: lesion.booleanHistory.map((entry) => String(entry)),
    })),
    thresholdMl: state.thresholdMl,
    section: {
      enabled: state.section.enabled,
      normal: [...state.section.normal] as Vec3Tuple,
      position: state.section.position,
      flip: state.section.flip,
    },
    viewMode: state.viewMode,
    activeLesionId: state.activeLesionId,
    booleanTargetId: state.booleanTargetId,
    booleanToolId: state.booleanToolId,
    keepBooleanOperand: state.keepBooleanOperand,
    drawThickness: state.drawThickness,
    drawSmoothing: state.drawSmoothing,
  }
}

export function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveStatus.value = 'pending'
  saveTimer = setTimeout(saveNow, 650)
}

export async function saveNow() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  try {
    saveStatus.value = 'saving'
    await idbSet(buildPersisted())
    saveStatus.value = 'saved'
    lastSavedAt.value = Date.now()
  } catch (error) {
    console.error(error)
    saveStatus.value = 'error'
  }
}

watch(state, () => scheduleSave(), { deep: true })

export async function restoreProject(): Promise<boolean> {
  try {
    const data = await idbGet<PersistedProject>()
    if (!data || data.app !== 'ct-mri-lesion-studio') return false
    await hydrateProject(data)
    notify('已从浏览器本地存储恢复项目', 'success', 2600)
    return true
  } catch (error) {
    console.warn('Restore failed', error)
    return false
  }
}

async function hydrateProject(data: PersistedProject | ProjectFile) {
  for (const lesion of state.lesions) viewer?.removeLesion(lesion.id)
  state.lesions.splice(0, state.lesions.length)
  viewer?.setOrgan(null)
  viewer?.setOrganOutline(null)

  state.thresholdMl = data.thresholdMl ?? 2
  state.viewMode = data.viewMode ?? 'all'
  state.section.enabled = data.section?.enabled ?? false
  state.section.normal = data.section?.normal ?? [1, 0, 0]
  state.section.position = data.section?.position ?? 0
  state.section.flip = data.section?.flip ?? false
  state.activeLesionId = data.activeLesionId ?? null
  state.drawThickness = (data as PersistedProject).drawThickness ?? 12
  state.drawSmoothing = (data as PersistedProject).drawSmoothing ?? 1
  state.booleanTargetId = (data as PersistedProject).booleanTargetId ?? null
  state.booleanToolId = (data as PersistedProject).booleanToolId ?? null
  state.keepBooleanOperand = (data as PersistedProject).keepBooleanOperand ?? false

  if (data.organ) {
    const organDto = data.organ
    const original =
      'positionsB64' in organDto.original ? meshFromBase64(organDto.original) : (organDto.original as MeshGeometryData)
    const bounds = getBounds(original)
    state.organ.status = 'ready'
    state.organ.name = organDto.name
    state.organ.format = organDto.format
    state.organ.original = markRaw(original)
    state.organ.geometry = markRaw(original)
    state.organ.simplifyLevel = 0
    state.organ.originalFaceCount = organDto.originalFaceCount ?? Math.floor(original.indices.length / 3)
    state.organ.faceCount = Math.floor(original.indices.length / 3)
    state.organ.vertexCount = original.positions.length / 3
    state.organ.size = bounds.size
    state.organ.min = bounds.min
    state.organ.max = bounds.max
    state.organ.volumeMm3 = signedVolumeMm3(original)
    state.organ.error = ''
    configureOrganCsg(original, '恢复的原始网格')

    const lesions = data.lesions.map((rawLesion) => {
      const lesion: Lesion = {
        ...rawLesion,
        points: rawLesion.points.map((p) => ({
          position: [...p.position] as Vec3Tuple,
          normal: [...p.normal] as Vec3Tuple,
        })),
        geometry: rawLesion.geometry
          ? markRaw('positionsB64' in rawLesion.geometry ? meshFromBase64(rawLesion.geometry as unknown as ProjectFile['lesions'][number]['geometry'] & object) : rawLesion.geometry)
          : null,
        occupiedGeometry: rawLesion.occupiedGeometry
          ? markRaw(
              'positionsB64' in rawLesion.occupiedGeometry
                ? meshFromBase64(rawLesion.occupiedGeometry as unknown as ProjectFile['lesions'][number]['occupiedGeometry'] & object)
                : rawLesion.occupiedGeometry,
            )
          : null,
      }
      return lesion
    })
    state.lesions.push(...lesions)
    if (!state.booleanTargetId) state.booleanTargetId = state.activeLesionId ?? state.lesions[0]?.id ?? null
    if (!state.booleanToolId) state.booleanToolId = state.lesions.find((l) => l.id !== state.booleanTargetId)?.id ?? null

    syncViewerAll()
    await setSimplifyLevel(organDto.simplifyLevel ?? 2)
    syncViewerAll()
  } else {
    state.organ.status = 'empty'
    syncViewerAll()
  }
}

export function exportProject() {
  if (!state.organ.original) {
    notify('请先载入器官模型后再导出', 'warning')
    return
  }

  const file: ProjectFile = {
    app: 'ct-mri-lesion-studio',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    organ: {
      name: state.organ.name,
      format: state.organ.format,
      simplifyLevel: state.organ.simplifyLevel,
      originalFaceCount: state.organ.originalFaceCount,
      original: meshToBase64(state.organ.original),
    },
    lesions: state.lesions.map((lesion) => ({
      id: lesion.id,
      name: lesion.name,
      color: lesion.color,
      visible: lesion.visible,
      points: lesion.points,
      thickness: lesion.thickness,
      smoothing: lesion.smoothing,
      geometry: lesion.geometry ? meshToBase64(lesion.geometry) : null,
      occupiedGeometry: lesion.occupiedGeometry ? meshToBase64(lesion.occupiedGeometry) : null,
      rawVolumeMm3: lesion.rawVolumeMm3,
      volumeMm3: lesion.volumeMm3,
      organRatio: lesion.organRatio,
      sectionAreaMm2: lesion.sectionAreaMm2,
      measureStatus: lesion.measureStatus,
      measureMessage: lesion.measureMessage,
      booleanHistory: lesion.booleanHistory,
      createdAt: lesion.createdAt,
    })),
    thresholdMl: state.thresholdMl,
    section: {
      enabled: state.section.enabled,
      normal: state.section.normal,
      position: state.section.position,
      flip: state.section.flip,
    },
    viewMode: state.viewMode,
    activeLesionId: state.activeLesionId,
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadJson(file, `病灶测量与剖面_${stamp}.json`)
  void saveNow()
  notify('已导出包含标注、体积、病灶网格和剖面位置的项目文件', 'success', 5200)
}

export async function importProjectFile(file: File) {
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    if (!validateProjectFile(parsed)) throw new Error('文件标识或版本不正确')
    await hydrateProject(parsed)
    await saveNow()
    notify(`已导入 ${file.name}，全部病灶与剖面位置已恢复`, 'success', 5200)
  } catch (error) {
    console.error(error)
    notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error', 7000)
  }
}
