import { useSyncExternalStore } from 'react';
import { skeletonStore, type StoreState } from '../store/skeletonStore';

export function useStore(): StoreState {
  return useSyncExternalStore(skeletonStore.subscribe, skeletonStore.getSnapshot);
}
