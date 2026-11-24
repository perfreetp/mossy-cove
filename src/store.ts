import { reactive } from 'vue';
import type { BufferGeometry } from 'three';
import type {
  AssemblyGroup,
  CorrespondencePair,
  FragmentRecord,
  InterferenceReport,
  ProjectSettings,
  RegistrationReport,
  SerializedGeometry,
  Vec3Tuple,
} from './types';
import { uid } from './lib/utils';

export const CATEGORIES = [
  '未归类',
  '股骨',
  '胫骨',
  '腓骨',
  '肱骨',
  '桡尺骨',
  '椎骨',
  '骨盆',
  '颅骨',
  '其他',
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  未归类: '#7dd3fc',
  股骨: '#60a5fa',
  胫骨: '#34d399',
  腓骨: '#a3e635',
  肱骨: '#fbbf24',
  桡尺骨: '#fb923c',
  椎骨: '#f472b6',
  骨盆: '#c084fc',
  颅骨: '#e879f9',
  其他: '#94a3b8',
};

export interface PickSession {
  aId: string;
  bId: string;
  awaiting: 'a' | 'b';
  aLocal?: Vec3Tuple;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

const defaultSettings: ProjectSettings = {
  residualThreshold: 1.0,
  overlapRatioLimit: 0.005,
  gapSearchLength: 20,
  showGrid: true,
  showAxes: true,
  deviationArrows: true,
};

export const store = reactive({
  projectName: '未命名骨骼拼接案',
  fragments: [] as FragmentRecord[],
  groups: [] as AssemblyGroup[],
  pairs: [] as CorrespondencePair[],
  selectedIds: [] as string[],
  activeFragmentId: null as string | null,
  tool: 'translate' as 'translate' | 'rotate',
  pickSession: null as PickSession | null,
  report: null as RegistrationReport | null,
  interference: null as InterferenceReport | null,
  settings: { ...defaultSettings },
  filter: '',
  categoryFilter: '全部',
  saveState: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
  lastSavedAt: null as number | null,
  storageAvailable: true,
  toasts: [] as ToastMessage[],
  busyMessage: '',
  manifoldReady: false,
});

/** Non-reactive Three.js geometry instances. */
export const geometryObjects = new Map<string, BufferGeometry>();
/** Imported/decoded serialization cache used by IndexedDB and file export. */
export const serializedGeometries = new Map<string, SerializedGeometry>();

export function toast(message: string, type: ToastMessage['type'] = 'info', timeout = 3600): void {
  const item: ToastMessage = { id: uid('toast'), type, message };
  store.toasts.push(item);
  window.setTimeout(() => {
    const index = store.toasts.findIndex((t) => t.id === item.id);
    if (index >= 0) store.toasts.splice(index, 1);
  }, timeout);
}

export function setBusy(message: string): void {
  store.busyMessage = message;
}

export function clearBusy(): void {
  store.busyMessage = '';
}

export function selectFragment(id: string | null, additive = false): void {
  if (!id) {
    store.selectedIds = [];
    store.activeFragmentId = null;
    return;
  }

  if (additive) {
    if (store.selectedIds.includes(id)) {
      store.selectedIds = store.selectedIds.filter((x) => x !== id);
      if (store.activeFragmentId === id) {
        store.activeFragmentId = store.selectedIds.at(-1) ?? null;
      }
    } else {
      const next = [...store.selectedIds, id];
      if (next.length > 2) {
        const removed = next.shift();
        toast(`配准选择最多两块，已替换最早选择的碎片 ${removed ?? ''}`, 'info');
      }
      store.selectedIds = next;
      store.activeFragmentId = id;
    }
  } else {
    store.selectedIds = [id];
    store.activeFragmentId = id;
  }
  store.report = null;
  store.interference = null;
}

export function getFragment(id: string | null | undefined): FragmentRecord | undefined {
  return store.fragments.find((f) => f.id === id);
}

export function getGroup(id: string | null | undefined): AssemblyGroup | undefined {
  return store.groups.find((g) => g.id === id);
}

export function fragmentCode(id: string): string {
  return getFragment(id)?.code ?? id.slice(-6);
}

export function nextDefaultCode(category?: string): string {
  const prefix = category && category !== '未归类' ? category.slice(0, 1) : 'F';
  let max = 0;
  for (const fragment of store.fragments) {
    const match = fragment.code.match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function resetProjectState(): void {
  store.projectName = '未命名骨骼拼接案';
  store.fragments.splice(0, store.fragments.length);
  store.groups.splice(0, store.groups.length);
  store.pairs.splice(0, store.pairs.length);
  store.selectedIds = [];
  store.activeFragmentId = null;
  store.pickSession = null;
  store.report = null;
  store.interference = null;
  store.settings = { ...defaultSettings };
  store.filter = '';
  store.categoryFilter = '全部';
  store.lastSavedAt = null;
  store.saveState = 'idle';
  geometryObjects.clear();
  serializedGeometries.clear();
}
