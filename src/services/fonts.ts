import { reactive } from 'vue'
import opentype from 'opentype.js'
import type { OutlineData, TextBlock } from '../types'

/* opentype.js v2 and the DefinitelyTyped v1 declarations diverge slightly.
   The small structural surface used here is safe to keep dynamically typed. */
type OtFont = any
type OtGlyph = any
type OtPath = any

interface FontState {
  noto: OtFont | null
  montserrat: OtFont | null
  ready: boolean
  error: string
}

export const fontState = reactive<FontState>({
  noto: null,
  montserrat: null,
  ready: false,
  error: '',
})

let loadPromise: Promise<void> | null = null

export function loadFonts(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const base = import.meta.env.BASE_URL
      const [notoBuffer, montserratBuffer] = await Promise.all([
        fetch(`${base}fonts/NotoSansSC.ttf`).then((r) => {
          if (!r.ok) throw new Error(`Noto font ${r.status}`)
          return r.arrayBuffer()
        }),
        fetch(`${base}fonts/Montserrat.ttf`).then((r) => {
          if (!r.ok) throw new Error(`Montserrat font ${r.status}`)
          return r.arrayBuffer()
        }),
      ])
      fontState.noto = opentype.parse(notoBuffer)
      fontState.montserrat = opentype.parse(montserratBuffer)
      fontState.ready = true
    } catch (error) {
      fontState.error = error instanceof Error ? error.message : String(error)
      // System fonts remain available through CSS in controls; outline export reports the error.
      fontState.ready = false
    }
  })()
  return loadPromise
}

function chooseFont(char: string, primary: OtFont | null, fallback: OtFont | null): OtFont | null {
  if (!primary) return fallback
  const glyph = primary.charToGlyph(char)
  if (glyph && glyph.index !== 0) return primary
  return fallback ?? primary
}

function measureLine(chars: string[], primary: OtFont | null, fallback: OtFont | null, fontSize: number, letterSpacing: number): number {
  let width = 0
  let previousGlyph: OtGlyph | null = null
  let previousFont: OtFont | null = null

  chars.forEach((char, index) => {
    const font = chooseFont(char, primary, fallback)
    if (!font) return
    const glyph = font.charToGlyph(char)
    const scale = fontSize / font.unitsPerEm
    if (previousGlyph && previousFont === font) {
      width += (font.getKerningValue(previousGlyph, glyph) || 0) * scale
    }
    width += (glyph.advanceWidth ?? 0) * scale
    if (index < chars.length - 1) width += letterSpacing
    previousGlyph = glyph
    previousFont = font
  })
  return width
}

export function buildTextOutline(block: TextBlock): OutlineData | null {
  if (!fontState.noto && !fontState.montserrat) return null
  const primary = block.fontId === 'montserrat' ? fontState.montserrat : fontState.noto
  const fallback = fontState.noto ?? fontState.montserrat
  if (!primary && !fallback) return null

  const combined: OtPath = new opentype.Path()
  const lines = block.content.replace(/\r\n/g, '\n').split('\n')
  const lineHeightPx = block.fontSize * block.lineHeight

  lines.forEach((line, lineIndex) => {
    const chars = Array.from(line)
    const lineWidth = measureLine(chars, primary, fallback, block.fontSize, block.letterSpacing)
    let cursor = -lineWidth / 2
    const baseline = block.fontSize * 0.82 + lineIndex * lineHeightPx
    let previousGlyph: OtGlyph | null = null
    let previousFont: OtFont | null = null

    chars.forEach((char, charIndex) => {
      const font = chooseFont(char, primary, fallback)
      if (!font) return
      const glyph = font.charToGlyph(char)
      const scale = block.fontSize / font.unitsPerEm
      if (previousGlyph && previousFont === font) {
        cursor += (font.getKerningValue(previousGlyph, glyph) || 0) * scale
      }

      const glyphPath = glyph.getPath(cursor, baseline, block.fontSize)
      for (const command of glyphPath.commands) {
        combined.commands.push({ ...command })
      }

      cursor += (glyph.advanceWidth ?? 0) * scale
      if (charIndex < chars.length - 1) cursor += block.letterSpacing
      previousGlyph = glyph
      previousFont = font
    })
  })

  if (!combined.commands.length) {
    return { d: '', width: 0, height: block.fontSize, x1: 0, y1: 0, x2: 0, y2: block.fontSize, lines: lines.length }
  }

  const box = combined.getBoundingBox()
  return {
    d: combined.toPathData(3),
    width: Math.max(1, box.x2 - box.x1),
    height: Math.max(1, box.y2 - box.y1),
    x1: box.x1,
    y1: box.y1,
    x2: box.x2,
    y2: box.y2,
    lines: lines.length,
  }
}

export function downloadTextFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
