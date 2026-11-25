import type { ProjectData, ProjectFile } from '../types'
import { normalizeProject } from '../state/projectFactory'

export function downloadProjectFile(project: ProjectData): void {
  const payload: ProjectFile = {
    app: 'cloud-sea-terrain-generator',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  anchor.href = url
  anchor.download = `cloud-sea-terrain-${stamp}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readProjectFile(file: File): Promise<ProjectData> {
  const text = await file.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON。')
  }

  const maybeEnvelope = json as Partial<ProjectFile>
  const candidate = maybeEnvelope.app === 'cloud-sea-terrain-generator' && maybeEnvelope.project
    ? maybeEnvelope.project
    : json

  const normalized = normalizeProject(candidate)
  if (!normalized.heights.length || normalized.bands.length < 2) {
    throw new Error('文件缺少有效的高度场或云带数据。')
  }
  return normalized
}
