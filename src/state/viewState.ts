import { reactive } from 'vue'
import type { CameraViewState } from '../types'

export const viewState = reactive<CameraViewState>({
  progress: 0,
  playing: false,
  showPath: true,
  speed: 1,
  order: [],
})
