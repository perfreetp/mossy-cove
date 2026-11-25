export const WORLD_SIZE = 220
export const HEIGHT_RES = 65
export const MASK_RES = 128
export const CLOUD_SIZE = WORLD_SIZE * 1.55
export const MIN_BANDS = 2
export const MAX_BANDS = 4
export const HISTORY_LIMIT = 90
export const STORAGE_KEY = 'cloud-sea-terrain-generator:project:v1'

export const RELIEF_OPTIONS: Array<{
  value: 'rolling' | 'ridges' | 'alpine'
  label: string
  hint: string
}> = [
  { value: 'rolling', label: '平缓丘陵', hint: '圆润长波，适合柔和云海' },
  { value: 'ridges', label: '连绵山脊', hint: '连续脊线与明显山谷' },
  { value: 'alpine', label: '嶙峋高峰', hint: '陡峭峰顶和强切割' },
]
