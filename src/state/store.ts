import { ref, watch } from 'vue'
import { HISTORY_LIMIT, STORAGE_KEY } from '../constants'
import { generateHeightField } from '../terrain/generate'
import type { ProjectData } from '../types'
import { createBand, normalizeProject } from './projectFactory'

function loadInitialProject(): ProjectData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return normalizeProject(undefined)
    return normalizeProject(JSON.parse(raw))
  } catch (error) {
    console.warn('读取浏览器存档失败，已使用默认地形。', error)
    return normalizeProject(undefined)
  }
}

export const project = ref<ProjectData>(loadInitialProject())
export const selectedBandId = ref<string>(project.value.bands[0]?.id ?? '')
export const canUndo = ref(false)
export const canRedo = ref(false)
export const undoLabel = ref('')
export const redoLabel = ref('')
export const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('saved')
export const lastSavedAt = ref<number | null>(null)

interface HistoryEntry {
  snapshot: string
  label: string
}

const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
let gestureSnapshot: string | null = null
let terrainTimer: number | undefined

function updateFlags(): void {
  canUndo.value = undoStack.length > 0
  canRedo.value = redoStack.length > 0
  undoLabel.value = undoStack[undoStack.length - 1]?.label ?? ''
  redoLabel.value = redoStack[redoStack.length - 1]?.label ?? ''
}

function currentSnapshot(): string {
  return JSON.stringify(project.value)
}

function pushBefore(snapshot: string, label: string): void {
  undoStack.push({ snapshot, label })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
  updateFlags()
}

export const history = {
  /** Start a coalesced slider/drag/brush gesture. Safe to call repeatedly. */
  begin(): void {
    if (gestureSnapshot === null) gestureSnapshot = currentSnapshot()
  },
  commit(label = '参数调整'): void {
    if (gestureSnapshot === null) return
    const before = gestureSnapshot
    gestureSnapshot = null
    if (before !== currentSnapshot()) pushBefore(before, label)
  },
  cancel(): void {
    gestureSnapshot = null
  },
  run(label: string, mutator: () => void): void {
    const before = currentSnapshot()
    gestureSnapshot = null
    mutator()
    const after = currentSnapshot()
    if (before !== after) pushBefore(before, label)
  },
  undo(): void {
    const entry = undoStack.pop()
    if (!entry) return
    gestureSnapshot = null
    window.clearTimeout(terrainTimer)
    const current = currentSnapshot()
    redoStack.push({ snapshot: current, label: entry.label })
    project.value = normalizeProject(JSON.parse(entry.snapshot) as unknown)
    selectedBandId.value = project.value.bands.some((b) => b.id === selectedBandId.value)
      ? selectedBandId.value
      : (project.value.bands[0]?.id ?? '')
    updateFlags()
  },
  redo(): void {
    const entry = redoStack.pop()
    if (!entry) return
    gestureSnapshot = null
    window.clearTimeout(terrainTimer)
    undoStack.push({ snapshot: currentSnapshot(), label: entry.label })
    project.value = normalizeProject(JSON.parse(entry.snapshot) as unknown)
    selectedBandId.value = project.value.bands.some((b) => b.id === selectedBandId.value)
      ? selectedBandId.value
      : (project.value.bands[0]?.id ?? '')
    updateFlags()
  },
  reset(): void {
    undoStack.length = 0
    redoStack.length = 0
    gestureSnapshot = null
    updateFlags()
  },
}

let saveTimer: number | undefined

watch(
  project,
  () => {
    saveState.value = 'saving'
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value))
        saveState.value = 'saved'
        lastSavedAt.value = Date.now()
      } catch (error) {
        console.error('保存到浏览器失败', error)
        saveState.value = 'error'
      }
    }, 350)
  },
  { deep: true },
)

export function regenerateTerrainNow(): void {
  window.clearTimeout(terrainTimer)
  project.value.heights = generateHeightField(project.value.terrain, project.value.heightResolution)
}

/** Coalesces high-frequency slider input before rerunning the noise/erosion field. */
export function requestTerrainRegeneration(): void {
  window.clearTimeout(terrainTimer)
  terrainTimer = window.setTimeout(() => {
    project.value.heights = generateHeightField(project.value.terrain, project.value.heightResolution)
  }, 45)
}

export function addBand(): void {
  if (project.value.bands.length >= 4) return
  history.run('添加云带', () => {
    const band = createBand(project.value.bands.length)
    project.value.bands.push(band)
    selectedBandId.value = band.id
  })
}

export function removeBand(id: string): void {
  if (project.value.bands.length <= 2) return
  history.run('删除云带', () => {
    const index = project.value.bands.findIndex((b) => b.id === id)
    project.value.bands = project.value.bands.filter((b) => b.id !== id)
    if (selectedBandId.value === id) {
      selectedBandId.value = project.value.bands[Math.max(0, index - 1)]?.id ?? project.value.bands[0].id
    }
  })
}

export function toggleBandVisible(id: string): void {
  const band = project.value.bands.find((b) => b.id === id)
  if (!band) return
  history.run(band.visible ? '隐藏云带' : '显示云带', () => {
    band.visible = !band.visible
  })
}

export function replaceImportedProject(next: ProjectData): void {
  history.run('导入项目', () => {
    project.value = next
    selectedBandId.value = next.bands[0]?.id ?? ''
  })
}

export function createBlankProject(): void {
  history.run('新建项目', () => {
    const fresh = normalizeProject(undefined)
    project.value = fresh
    selectedBandId.value = fresh.bands[0]?.id ?? ''
  })
}
