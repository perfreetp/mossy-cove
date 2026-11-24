import { reactive } from 'vue'
import { buildTextOutline } from './fonts'
import type { BoundaryState, FaceDef, OutlineData, TextBlock } from '../types'

interface CacheEntry {
  signature: string
  outline: OutlineData | null
}

const cache = new Map<string, CacheEntry>()
export const boundaryMap = reactive<Record<string, BoundaryState>>({})

function signatureFor(text: TextBlock): string {
  return [text.content, text.fontId, text.fontSize, text.letterSpacing, text.lineHeight, text.bold].join('|')
}

export function getTextOutline(text: TextBlock): OutlineData | null {
  const signature = signatureFor(text)
  const cached = cache.get(text.id)
  if (cached && cached.signature === signature) return cached.outline

  const outline = buildTextOutline(text)
  cache.set(text.id, { signature, outline })
  if (cache.size > 240) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  return outline
}

export function getTextBoundary(text: TextBlock, face: FaceDef): BoundaryState {
  const outline = getTextOutline(text)
  if (!outline || outline.width <= 0) return { out: false, overflowX: 0, overflowY: 0 }

  const centerX = text.nx * face.width
  const centerY = text.ny * face.height
  const halfX = outline.width / 2 + (text.bold ? text.fontSize * 0.035 : 0)
  const halfY = outline.height / 2 + (text.bold ? text.fontSize * 0.025 : 0)
  const left = centerX - halfX
  const right = centerX + halfX
  const top = centerY - halfY
  const bottom = centerY + halfY
  const overflowX = Math.max(-left, right - face.width, 0)
  const overflowY = Math.max(-top, bottom - face.height, 0)
  return { out: overflowX > 0.75 || overflowY > 0.75, overflowX, overflowY }
}

export function refreshBoundaryMap(texts: TextBlock[], faceMap: Map<string, FaceDef>) {
  const next = new Set(texts.map((t) => t.id))
  for (const key of Object.keys(boundaryMap)) {
    if (!next.has(key)) delete boundaryMap[key]
  }
  for (const text of texts) {
    const face = faceMap.get(text.faceId)
    if (!face) continue
    boundaryMap[text.id] = getTextBoundary(text, face)
  }
}
