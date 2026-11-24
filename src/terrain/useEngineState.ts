import { useSyncExternalStore } from 'react';
import type { SandboxEngine } from './SandboxEngine';
import type { UiState } from './types';

export function useEngineState(engine: SandboxEngine): UiState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}
