import { writable, get } from 'svelte/store';

export const MAX_HISTORY = 100;
export const DETACH_OFFSET = [7.4, 0, 0];

export const FLOOR_COLORS = [
  '#7dd3fc',
  '#93c5fd',
  '#a5b4fc',
  '#c4b5fd',
  '#d8b4fe',
  '#f0abfc',
  '#f9a8d4',
  '#fda4af',
  '#fdba74',
  '#fcd34d',
  '#bef264',
  '#86efac'
];

let idSerial = 0;
function nextHistoryId() {
  idSerial += 1;
  return `h-${Date.now().toString(36)}-${idSerial}`;
}

function sanitizeVector(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  return [0, 1, 2].map((axis) => {
    const number = Number(Array.isArray(value) ? value[axis] : fallback[axis]);
    if (!Number.isFinite(number)) return fallback[axis];
    return Math.min(max, Math.max(min, number));
  });
}

export function makeFloor(index, previous = null) {
  if (previous) {
    return {
      id: `floor-${index + 1}`,
      index,
      name: typeof previous.name === 'string' && previous.name.trim()
        ? previous.name
        : `第 ${index + 1} 层`,
      visible: previous.visible !== false,
      detached: Boolean(previous.detached),
      position: sanitizeVector(previous.position, [0, 0, 0]),
      rotation: sanitizeVector(previous.rotation, [0, 0, 0]),
      scale: sanitizeVector(previous.scale, [1, 1, 1], { min: 0.08, max: 100 })
    };
  }

  return {
    id: `floor-${index + 1}`,
    index,
    name: `第 ${index + 1} 层`,
    visible: true,
    detached: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  };
}

export function createFloors(count, previousFloors = []) {
  return Array.from({ length: count }, (_, index) =>
    makeFloor(index, previousFloors[index] ?? null)
  );
}

export function createInitialDoc() {
  const floorCount = 7;
  return {
    app: 'micro-building-floor-splitter',
    version: 1,
    buildingId: 'tower',
    floorCount,
    floors: createFloors(floorCount),
    section: {
      enabled: true,
      helper: true,
      normal: [0, 1, 0],
      distance: 8.8,
      thickness: 0.09
    }
  };
}

function clone(value) {
  return structuredClone(value);
}

const initialDoc = createInitialDoc();

export const doc = writable(initialDoc);
export const ui = writable({
  selectedFloorId: 'floor-3',
  transformMode: 'translate',
  panelTab: 'edit'
});
export const cutFloorIds = writable([]);
export const geometryStatus = writable({ ready: false, message: '正在初始化 Manifold WASM…' });

export const history = writable({
  entries: [
    {
      id: nextHistoryId(),
      label: '放入退台塔楼',
      detail: '内置体块 · 7 层',
      at: new Date().toISOString(),
      snapshot: clone(initialDoc)
    }
  ],
  index: 0
});

function pushHistory(snapshot, label, detail = '') {
  history.update((current) => {
    const entries = current.entries.slice(0, current.index + 1);
    entries.push({
      id: nextHistoryId(),
      label,
      detail,
      at: new Date().toISOString(),
      snapshot: clone(snapshot)
    });

    let index = entries.length - 1;
    if (entries.length > MAX_HISTORY) {
      const overflow = entries.length - MAX_HISTORY;
      entries.splice(0, overflow);
      index -= overflow;
    }

    return { entries, index };
  });
}

/** Apply a serializable document mutation and record one undo step. */
export function commit(label, detail, mutator) {
  const next = clone(get(doc));
  mutator?.(next);
  doc.set(next);
  pushHistory(next, label, detail);
  return next;
}

/** Update the live document during a drag/slider gesture without adding history. */
export function preview(mutator) {
  const next = clone(get(doc));
  mutator?.(next);
  doc.set(next);
  return next;
}

function sameAsCurrentHistory(next) {
  const h = get(history);
  const entry = h.entries[h.index];
  return JSON.stringify(entry.snapshot) === JSON.stringify(next);
}

/** Commit a gesture after preview() calls. No entry is added if nothing changed. */
export function commitCurrent(label, detail = '') {
  const next = get(doc);
  if (sameAsCurrentHistory(next)) return false;
  pushHistory(next, label, detail);
  return true;
}

function ensureSelectionForDoc(nextDoc) {
  ui.update((value) => {
    if (
      value.selectedFloorId &&
      nextDoc.floors.some((floor) => floor.id === value.selectedFloorId)
    ) {
      return value;
    }
    return {
      ...value,
      selectedFloorId: value.selectedFloorId
        ? (nextDoc.floors[Math.min(2, nextDoc.floors.length - 1)]?.id ?? null)
        : null
    };
  });
}

export function undo() {
  const h = get(history);
  if (h.index <= 0) return false;
  const index = h.index - 1;
  const nextDoc = clone(h.entries[index].snapshot);
  doc.set(nextDoc);
  ensureSelectionForDoc(nextDoc);
  history.set({ ...h, index });
  return true;
}

export function redo() {
  const h = get(history);
  if (h.index >= h.entries.length - 1) return false;
  const index = h.index + 1;
  const nextDoc = clone(h.entries[index].snapshot);
  doc.set(nextDoc);
  ensureSelectionForDoc(nextDoc);
  history.set({ ...h, index });
  return true;
}

export function jumpToHistory(index) {
  const h = get(history);
  if (!Number.isInteger(index) || index < 0 || index >= h.entries.length) return false;
  const nextDoc = clone(h.entries[index].snapshot);
  doc.set(nextDoc);
  ensureSelectionForDoc(nextDoc);
  history.set({ ...h, index });
  return true;
}

export function selectFloor(id) {
  ui.update((value) => ({ ...value, selectedFloorId: id }));
}

export function setTransformMode(mode) {
  ui.update((value) => ({ ...value, transformMode: mode }));
}

export function replaceProject(projectDoc, projectHistory = null) {
  const safeDoc = normalizeDoc(projectDoc);
  doc.set(safeDoc);

  if (projectHistory?.entries?.length) {
    const entries = projectHistory.entries
      .filter((entry) => entry?.label && entry?.snapshot)
      .map((entry) => ({
        id: entry.id ?? nextHistoryId(),
        label: String(entry.label),
        detail: entry.detail ?? '',
        at: entry.at ?? new Date().toISOString(),
        snapshot: normalizeDoc(entry.snapshot)
      }));

    if (entries.length) {
      const index = Math.min(
        Math.max(0, Number(projectHistory.index) || 0),
        entries.length - 1
      );
      const snapshot = entries[index].snapshot;
      doc.set(clone(snapshot));
      history.set({ entries, index });
      ui.update((value) => ({
        ...value,
        selectedFloorId: snapshot.floors?.[Math.min(2, snapshot.floors.length - 1)]?.id ?? null
      }));
      return;
    }
  }

  history.set({
    entries: [
      {
        id: nextHistoryId(),
        label: '导入沙盘',
        detail: `${safeDoc.buildingId} · ${safeDoc.floorCount} 层`,
        at: new Date().toISOString(),
        snapshot: clone(safeDoc)
      }
    ],
    index: 0
  });
  ui.update((value) => ({
    ...value,
    selectedFloorId: safeDoc.floors[Math.min(2, safeDoc.floors.length - 1)]?.id ?? null
  }));
}

export function normalizeDoc(input) {
  const source = input && typeof input === 'object' ? input : {};
  const floorCount = Math.max(1, Math.min(30, Number(source.floorCount) || 7));
  const previousFloors = Array.isArray(source.floors) ? source.floors : [];
  const floors = createFloors(floorCount, previousFloors);

  const sectionSource = source.section ?? {};
  const normal = Array.isArray(sectionSource.normal) && sectionSource.normal.length === 3
    ? sectionSource.normal.map(Number)
    : [0, 1, 0];
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]) || 1;

  return {
    app: 'micro-building-floor-splitter',
    version: 1,
    buildingId: typeof source.buildingId === 'string' ? source.buildingId : 'tower',
    floorCount,
    floors,
    section: {
      enabled: sectionSource.enabled !== false,
      helper: sectionSource.helper !== false,
      normal: [
        normal[0] / normalLength,
        normal[1] / normalLength,
        normal[2] / normalLength
      ],
      distance: Number.isFinite(Number(sectionSource.distance))
        ? Number(sectionSource.distance)
        : 8.8,
      thickness: Math.min(0.5, Math.max(0.02, Number(sectionSource.thickness) || 0.09))
    }
  };
}
