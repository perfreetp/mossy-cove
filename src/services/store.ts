import { reactive } from 'vue'
import { BOOTH_MODELS, getModel } from '../data/booths'
export { BOOTH_MODELS, getModel }
import { MATERIALS } from '../data/materials'
import type { Scheme, SchemeSlot, TextBlock } from '../types'

const STORAGE_KEY = 'booth-brand-studio-v1'

interface StudioState {
  step: number
  modelId: string
  selectedFaceId: string | null
  selectedTextId: string | null
  hoveredFaceId: string | null
  activeSlot: number
  doc: Scheme
  slots: SchemeSlot[]
  toast: { message: string; tone: 'ok' | 'error' | 'info'; key: number } | null
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function makeTextId(): string {
  return `txt-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export function createText(faceId: string, patch: Partial<TextBlock> = {}): TextBlock {
  return {
    id: makeTextId(),
    faceId,
    content: 'NOVA',
    fontId: 'montserrat',
    nx: 0.5,
    ny: 0.5,
    fontSize: 40,
    letterSpacing: 6,
    lineHeight: 1.16,
    color: '#ffffff',
    bold: true,
    ...patch,
  }
}

export function createDefaultAssignments(modelId: string): Record<string, string> {
  const model = getModel(modelId)
  const assignments: Record<string, string> = {}
  model.faces.forEach((face, index) => {
    if (face.kind === 'top') {
      assignments[face.id] = index % 4 === 0 ? 'mat-cloud-gray' : 'mat-pearl'
    } else if (face.group === '接待台' && face.id.endsWith('-front')) {
      assignments[face.id] = 'mat-brand-blue'
    } else if (face.group === '中央展柜' && face.id.endsWith('-front')) {
      assignments[face.id] = 'mat-graphite'
    } else if (face.group === '品牌柱' && (face.id.endsWith('-front') || face.id.endsWith('-right'))) {
      assignments[face.id] = 'mat-lightbox'
    } else if (face.kind === 'wall') {
      assignments[face.id] = index % 9 === 0 ? 'mat-led-dark' : index % 2 === 0 ? 'mat-pearl' : 'mat-cloud-gray'
    } else {
      assignments[face.id] = 'mat-pearl'
    }
  })

  const featureFaces = model.faces
    .filter((face) => face.textAllowed)
    .sort((a, b) => b.width * b.height - a.width * a.height)
  if (featureFaces[0]) assignments[featureFaces[0].id] = 'mat-brand-blue'
  if (featureFaces[1]) assignments[featureFaces[1].id] = 'mat-graphite'
  if (featureFaces[2]) assignments[featureFaces[2].id] = 'mat-lightbox'

  return assignments
}

function createDefaultTexts(modelId: string): TextBlock[] {
  const model = getModel(modelId)
  const candidates = model.faces
    .filter((face) => face.textAllowed)
    .sort((a, b) => b.width * b.height - a.width * a.height)
  const first = candidates[0]
  const second = candidates[1] ?? first
  const third = candidates[2] ?? first
  const texts: TextBlock[] = []
  if (first) {
    texts.push(createText(first.id, { content: 'NOVA', fontSize: 42, letterSpacing: 8, color: first.id.includes('wall') ? '#ffffff' : '#ffffff' }))
  }
  if (second && second.id !== first?.id) {
    texts.push(createText(second.id, { content: '2026', fontSize: 38, letterSpacing: 10, color: '#eaf2ff' }))
  }
  if (third && third.id !== first?.id && third.id !== second?.id) {
    texts.push(createText(third.id, { content: '新品发布', fontId: 'noto', fontSize: 30, letterSpacing: 4, bold: true, color: '#102033' }))
  }
  return texts
}

export function createDefaultScheme(modelId = BOOTH_MODELS[0].id): Scheme {
  return {
    schema: 'booth-brand-scheme',
    schemaVersion: 1,
    name: '未命名发布会方案',
    modelId,
    assignments: createDefaultAssignments(modelId),
    texts: createDefaultTexts(modelId),
    updatedAt: new Date().toISOString(),
  }
}

function createSlots(): SchemeSlot[] {
  return [
    { id: 'A', label: '方案 A', savedAt: null, scheme: null },
    { id: 'B', label: '方案 B', savedAt: null, scheme: null },
    { id: 'C', label: '方案 C', savedAt: null, scheme: null },
  ]
}

interface PersistedState {
  activeSlot?: number
  slots?: SchemeSlot[]
  doc?: Scheme
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : null
  } catch {
    return null
  }
}

const persisted = typeof localStorage !== 'undefined' ? loadPersisted() : null

function initialDoc(): Scheme {
  if (persisted?.doc?.schema === 'booth-brand-scheme' && getModel(persisted.doc.modelId)) {
    return persisted.doc
  }
  return createDefaultScheme()
}

export const studio = reactive<StudioState>({
  step: 0,
  modelId: initialDoc().modelId,
  selectedFaceId: null,
  selectedTextId: null,
  hoveredFaceId: null,
  activeSlot: typeof persisted?.activeSlot === 'number' ? Math.min(2, Math.max(0, persisted.activeSlot)) : 0,
  doc: initialDoc(),
  slots: Array.isArray(persisted?.slots) && persisted.slots.length === 3 ? persisted.slots : createSlots(),
  toast: null,
})

// Select a useful face after initialization without touching persisted data.
if (!studio.selectedFaceId) {
  const model = getModel(studio.modelId)
  studio.selectedFaceId = model.faces.find((f) => f.textAllowed)?.id ?? model.faces[0]?.id ?? null
}

let toastTimer: number | undefined

export function showToast(message: string, tone: 'ok' | 'error' | 'info' = 'ok') {
  studio.toast = { message, tone, key: Date.now() }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    studio.toast = null
  }, 3200)
}

export function persistState() {
  try {
    const payload = {
      activeSlot: studio.activeSlot,
      slots: studio.slots,
      doc: studio.doc,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('persist failed', error)
  }
}

export function setStep(step: number) {
  studio.step = step
}

export function selectFace(faceId: string | null) {
  studio.selectedFaceId = faceId
  if (faceId) studio.hoveredFaceId = faceId
}

export function setHoveredFace(faceId: string | null) {
  studio.hoveredFaceId = faceId
}

export function selectText(textId: string | null) {
  studio.selectedTextId = textId
  if (textId) {
    const text = studio.doc.texts.find((item) => item.id === textId)
    if (text) studio.selectedFaceId = text.faceId
  }
}

export function chooseModel(modelId: string) {
  if (!getModel(modelId)) return
  studio.modelId = modelId
  studio.doc = createDefaultScheme(modelId)
  studio.selectedTextId = null
  studio.selectedFaceId = getModel(modelId).faces.find((f) => f.textAllowed)?.id ?? null
  persistState()
}

export function assignMaterial(materialId: string, faceId: string | null = studio.selectedFaceId) {
  if (!faceId) {
    showToast('请先在展开图或三维视图中选择一个面', 'info')
    return
  }
  if (!MATERIALS.some((m) => m.id === materialId)) return
  studio.doc.assignments[faceId] = materialId
}

export function updateText(textId: string, patch: Partial<TextBlock>) {
  const text = studio.doc.texts.find((item) => item.id === textId)
  if (!text) return
  Object.assign(text, patch)
}

export function addText(faceId: string | null = studio.selectedFaceId): TextBlock | null {
  const model = getModel(studio.modelId)
  const face = model.faces.find((item) => item.id === faceId && item.textAllowed)
    ?? model.faces.find((item) => item.textAllowed)
  if (!face) {
    showToast('当前展台没有可放置品牌文字的立面', 'error')
    return null
  }
  const text = createText(face.id, {
    nx: 0.5,
    ny: 0.5,
    fontSize: Math.min(48, Math.max(24, face.height * 0.14)),
  })
  studio.doc.texts.push(text)
  studio.selectedTextId = text.id
  studio.selectedFaceId = face.id
  return text
}

export function removeText(textId: string) {
  const index = studio.doc.texts.findIndex((item) => item.id === textId)
  if (index >= 0) studio.doc.texts.splice(index, 1)
  if (studio.selectedTextId === textId) studio.selectedTextId = null
}

export function duplicateText(textId: string) {
  const text = studio.doc.texts.find((item) => item.id === textId)
  if (!text) return
  const copy = clone(text)
  copy.id = makeTextId()
  copy.nx = Math.min(0.92, copy.nx + 0.06)
  copy.ny = Math.min(0.92, copy.ny + 0.08)
  studio.doc.texts.push(copy)
  studio.selectedTextId = copy.id
}

export function addDemoTexts(count = 12) {
  const model = getModel(studio.modelId)
  const faces = model.faces.filter((f) => f.textAllowed)
  if (!faces.length) return
  const words = ['NOVA', 'FUTURE', 'AI 2026', '新品发布', 'KEYNOTE', 'INNOVATION', '品牌盛典', 'LIVE', 'CONNECT', '视界', 'launch', '舞台']
  const colors = ['#ffffff', '#102033', '#dff7ff', '#ffe7a3']
  for (let i = 0; i < count; i++) {
    const face = faces[i % faces.length]
    studio.doc.texts.push(createText(face.id, {
      content: words[i % words.length],
      fontId: i % 3 === 0 ? 'noto' : 'montserrat',
      nx: 0.5 + ((i % 3) - 1) * 0.08,
      ny: 0.34 + (Math.floor(i / faces.length) % 3) * 0.22,
      fontSize: 26 + (i % 4) * 5,
      letterSpacing: 2 + (i % 5) * 2,
      color: colors[i % colors.length],
    }))
  }
  showToast(`已加入 ${count} 个演示文字块，可拖动测试流畅度`)
}

export function isSlotDirty(index: number): boolean {
  const slot = studio.slots[index]
  if (!slot?.scheme) return false
  return JSON.stringify(studio.doc) !== JSON.stringify(slot.scheme)
}

export function saveToSlot(index: number) {
  const now = new Date().toISOString()
  studio.doc.updatedAt = now
  studio.slots[index] = {
    ...studio.slots[index],
    savedAt: now,
    scheme: clone(studio.doc),
  }
  studio.activeSlot = index
  persistState()
  showToast(`已保存到${studio.slots[index].label}`)
}

export function loadFromSlot(index: number): boolean {
  const slot = studio.slots[index]
  if (!slot?.scheme) {
    showToast('该方案位还是空的，请先保存', 'info')
    return false
  }
  const scheme = normalizeScheme(slot.scheme)
  studio.doc = reactive(scheme) as Scheme
  studio.modelId = scheme.modelId
  studio.activeSlot = index
  studio.selectedTextId = null
  studio.selectedFaceId = getModel(scheme.modelId).faces.find((f) => f.textAllowed)?.id ?? null
  persistState()
  showToast(`已切换到${slot.label}，配色与文字排布已还原`)
  return true
}

function normalizeText(raw: unknown, faceIds: Set<string>): TextBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<TextBlock>
  if (typeof value.faceId !== 'string' || !faceIds.has(value.faceId)) return null
  return createText(value.faceId, {
    id: typeof value.id === 'string' ? value.id : makeTextId(),
    content: typeof value.content === 'string' ? value.content.slice(0, 120) : 'NOVA',
    fontId: value.fontId === 'noto' ? 'noto' : 'montserrat',
    nx: Number.isFinite(value.nx) ? Number(value.nx) : 0.5,
    ny: Number.isFinite(value.ny) ? Number(value.ny) : 0.5,
    fontSize: Number.isFinite(value.fontSize) ? Math.min(260, Math.max(8, Number(value.fontSize))) : 40,
    letterSpacing: Number.isFinite(value.letterSpacing) ? Math.min(80, Math.max(-20, Number(value.letterSpacing))) : 4,
    lineHeight: Number.isFinite(value.lineHeight) ? Math.min(2.4, Math.max(0.8, Number(value.lineHeight))) : 1.16,
    color: typeof value.color === 'string' ? value.color : '#ffffff',
    bold: Boolean(value.bold),
  })
}

export function normalizeScheme(raw: unknown): Scheme {
  if (!raw || typeof raw !== 'object') throw new Error('文件内容不是有效方案')
  const value = raw as Partial<Scheme>
  const modelId = typeof value.modelId === 'string' && getModel(value.modelId) ? value.modelId : BOOTH_MODELS[0].id
  const model = getModel(modelId)
  const faceIds = new Set(model.faces.map((f) => f.id))
  const materialIds = new Set(MATERIALS.map((m) => m.id))
  const assignments: Record<string, string> = {}

  if (value.assignments && typeof value.assignments === 'object') {
    for (const [faceId, materialId] of Object.entries(value.assignments as Record<string, unknown>)) {
      if (faceIds.has(faceId) && typeof materialId === 'string' && materialIds.has(materialId)) {
        assignments[faceId] = materialId
      }
    }
  }
  for (const face of model.faces) {
    if (!assignments[face.id]) assignments[face.id] = createDefaultAssignments(modelId)[face.id]
  }

  const texts = Array.isArray(value.texts)
    ? value.texts.map((item) => normalizeText(item, faceIds)).filter((item): item is TextBlock => item !== null)
    : []

  return {
    schema: 'booth-brand-scheme',
    schemaVersion: 1,
    name: typeof value.name === 'string' ? value.name.slice(0, 80) : '导入的发布会方案',
    modelId,
    assignments,
    texts,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

export function importJsonText(jsonText: string): { kind: 'scheme' | 'bundle' } {
  const parsed = JSON.parse(jsonText) as unknown
  if (parsed && typeof parsed === 'object' && (parsed as { app?: string }).app === 'booth-brand-studio-backup') {
    const bundle = parsed as { slots?: unknown; activeSlot?: number; draft?: unknown }
    if (Array.isArray(bundle.slots) && bundle.slots.length === 3) {
      studio.slots = bundle.slots.map((slot, index) => {
        const item = slot as Partial<SchemeSlot>
        return {
          id: ['A', 'B', 'C'][index],
          label: `方案 ${['A', 'B', 'C'][index]}`,
          savedAt: typeof item.savedAt === 'string' ? item.savedAt : null,
          scheme: item.scheme ? normalizeScheme(item.scheme) : null,
        }
      }) as SchemeSlot[]
    }
    const draft = bundle.draft ? normalizeScheme(bundle.draft) : studio.slots[bundle.activeSlot ?? studio.activeSlot]?.scheme
    if (draft) {
      studio.doc = reactive(draft) as Scheme
      studio.modelId = draft.modelId
    }
    studio.activeSlot = typeof bundle.activeSlot === 'number' ? bundle.activeSlot : 0
    persistState()
    return { kind: 'bundle' }
  }

  const scheme = normalizeScheme(parsed)
  studio.doc = reactive(scheme) as Scheme
  studio.modelId = scheme.modelId
  studio.selectedTextId = null
  studio.selectedFaceId = getModel(scheme.modelId).faces[0]?.id ?? null
  persistState()
  return { kind: 'scheme' }
}

export function createExportBundle() {
  return {
    app: 'booth-brand-studio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    activeSlot: studio.activeSlot,
    slots: clone(studio.slots),
    draft: clone(studio.doc),
  }
}
