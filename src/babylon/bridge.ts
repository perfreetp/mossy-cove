import type { ShallowRef } from 'vue'
import { shallowRef } from 'vue'
import type { SceneManager } from './SceneManager'

export const sceneManagerRef: ShallowRef<SceneManager | null> = shallowRef(null)
