import type { MeshGeometryData, ProjectFile, ProjectFileMesh } from './types'

export function meshToBase64(mesh: MeshGeometryData): ProjectFileMesh {
  return {
    positionsB64: bytesToBase64(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength)),
    indicesB64: bytesToBase64(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)),
  }
}

export function meshFromBase64(dto: ProjectFileMesh): MeshGeometryData {
  const positionBytes = base64ToBytes(dto.positionsB64)
  const indexBytes = base64ToBytes(dto.indicesB64)
  const positions = new Float32Array(positionBytes.byteLength / 4)
  new Uint8Array(positions.buffer).set(positionBytes)
  const indices = new Uint32Array(indexBytes.byteLength / 4)
  new Uint8Array(indices.buffer).set(indexBytes)
  return { positions, indices }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function validateProjectFile(value: unknown): value is ProjectFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ProjectFile>
  return file.app === 'ct-mri-lesion-studio' && file.formatVersion === 1 && Array.isArray(file.lesions)
}
