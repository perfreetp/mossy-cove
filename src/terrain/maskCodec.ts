export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function base64ToBytes(value: string, expectedLength: number): Uint8Array {
  if (!value) {
    const all = new Uint8Array(expectedLength)
    all.fill(255)
    return all
  }
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(Math.min(binary.length, expectedLength))
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i)
    if (bytes.length < expectedLength) {
      const padded = new Uint8Array(expectedLength)
      padded.fill(255)
      padded.set(bytes)
      return padded
    }
    return bytes
  } catch {
    const all = new Uint8Array(expectedLength)
    all.fill(255)
    return all
  }
}

export function fullMaskBase64(length: number): string {
  const bytes = new Uint8Array(length)
  bytes.fill(255)
  return bytesToBase64(bytes)
}
