import { createStore, produce } from 'solid-js/store';
import { createEffect, createMemo, createSignal } from 'solid-js';
import type {
  Doc,
  IceBlock,
  IceKind,
  Light,
  Scheme,
  Selection,
  Vec3,
} from './types';
import { ICE_KIND_LABEL } from './types';
import { computeAllPaths, firstIceHit, lightDirection } from '../three/transmission';

const STORAGE_KEY = 'ice-lantern-layout-v1';

function uid(): string {
  return crypto.randomUUID();
}

function defaultDoc(): Doc {
  return {
    iceBlocks: [
      {
        id: uid(),
        kind: 'wall',
        name: '冰墙 1',
        position: [0, 1.5, 0],
        size: [4, 3, 0.8],
        rotationY: 0,
        turbidity: 0.35,
      },
      {
        id: uid(),
        kind: 'column',
        name: '冰柱 1',
        position: [-3.5, 1.6, -2],
        size: [1, 3.2, 1],
        rotationY: 0,
        turbidity: 0.2,
      },
      {
        id: uid(),
        kind: 'brick',
        name: '冰砖 1',
        position: [3, 0.5, 2],
        size: [1.4, 1, 1.4],
        rotationY: 0,
        turbidity: 0.5,
      },
    ],
    lights: [
      {
        id: uid(),
        name: '灯 1',
        position: [0, 2.2, 5],
        azimuth: 180,
        elevation: -15,
        kelvin: 3200,
        intensity: 2.2,
        spread: 0.4,
        softness: 2,
        groupId: null,
      },
      {
        id: uid(),
        name: '灯 2',
        position: [-4.5, 1.8, 3],
        azimuth: 160,
        elevation: -10,
        kelvin: 6500,
        intensity: 1.8,
        spread: 0.3,
        softness: 1,
        groupId: null,
      },
    ],
    groups: [],
  };
}

interface AppState {
  doc: Doc;
  selection: Selection;
  schemes: Scheme[];
  compareA: string | null;
  compareB: string | null;
  transformMode: 'translate' | 'rotate';
}

function loadInitial(): AppState {
  const fallback: AppState = {
    doc: defaultDoc(),
    selection: null,
    schemes: [],
    compareA: null,
    compareB: null,
    transformMode: 'translate',
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    if (!data || !data.doc || !Array.isArray(data.doc.lights) || !Array.isArray(data.doc.iceBlocks)) {
      return fallback;
    }
    return {
      ...fallback,
      doc: { groups: [], ...data.doc },
      schemes: Array.isArray(data.schemes) ? data.schemes : [],
    };
  } catch {
    return fallback;
  }
}

export const [state, setState] = createStore<AppState>(loadInitial());

/* ---------------- 撤销 / 重做(快照式) ---------------- */

const [canUndo, setCanUndo] = createSignal(false);
const [canRedo, setCanRedo] = createSignal(false);
export { canUndo, canRedo };

let past: string[] = [];
let future: string[] = [];

const snap = () => JSON.stringify(state.doc);

/** 在一次变更(或一次拖拽手势)开始前调用,记录历史 */
export function beginHistory() {
  const s = snap();
  if (past[past.length - 1] !== s) {
    past.push(s);
    if (past.length > 100) past.shift();
  }
  future = [];
  setCanUndo(true);
  setCanRedo(false);
}

function fixSelection() {
  const sel = state.selection;
  if (!sel) return;
  const exists =
    sel.kind === 'ice'
      ? state.doc.iceBlocks.some((b) => b.id === sel.id)
      : sel.kind === 'light'
        ? state.doc.lights.some((l) => l.id === sel.id)
        : state.doc.groups.some((g) => g.id === sel.id);
  if (!exists) setState('selection', null);
}

export function undo() {
  if (!past.length) return;
  future.push(snap());
  const s = past.pop()!;
  setState('doc', JSON.parse(s));
  setCanUndo(past.length > 0);
  setCanRedo(true);
  fixSelection();
}

export function redo() {
  if (!future.length) return;
  past.push(snap());
  const s = future.pop()!;
  setState('doc', JSON.parse(s));
  setCanUndo(true);
  setCanRedo(future.length > 0);
  fixSelection();
}

/* ---------------- 选择 ---------------- */

export function select(sel: Selection) {
  setState('selection', sel);
}

export function setTransformMode(mode: 'translate' | 'rotate') {
  setState('transformMode', mode);
}

/* ---------------- 冰体 ---------------- */

export function addIce(kind: IceKind) {
  beginHistory();
  const sizes: Record<IceKind, Vec3> = {
    wall: [4, 3, 0.8],
    column: [1, 3.2, 1],
    brick: [1.4, 1, 1.4],
  };
  const size = sizes[kind];
  const count = state.doc.iceBlocks.filter((b) => b.kind === kind).length + 1;
  const block: IceBlock = {
    id: uid(),
    kind,
    name: `${ICE_KIND_LABEL[kind]} ${count}`,
    position: [Math.random() * 6 - 3, size[1] / 2, Math.random() * 6 - 3],
    size: [...size],
    rotationY: 0,
    turbidity: 0.35,
  };
  setState('doc', 'iceBlocks', (arr) => [...arr, block]);
  setState('selection', { kind: 'ice', id: block.id });
}

export function updateIce(id: string, patch: Partial<Omit<IceBlock, 'id'>>) {
  setState(
    'doc',
    'iceBlocks',
    (b) => b.id === id,
    (b) => {
      const next = { ...b, ...patch };
      // 高度变化时保持底面贴地
      if (patch.size) next.position = [next.position[0], next.size[1] / 2, next.position[2]];
      return next;
    },
  );
}

export function removeIce(id: string) {
  beginHistory();
  setState('doc', 'iceBlocks', (arr) => arr.filter((b) => b.id !== id));
  fixSelection();
}

/* ---------------- 灯 ---------------- */

export function addLight() {
  beginHistory();
  const light: Light = {
    id: uid(),
    name: `灯 ${state.doc.lights.length + 1}`,
    position: [Math.random() * 4 - 2, 2.2, 6],
    azimuth: 180,
    elevation: -15,
    kelvin: 3200,
    intensity: 2,
    spread: 0.4,
    softness: 2,
    groupId: null,
  };
  setState('doc', 'lights', (arr) => [...arr, light]);
  setState('selection', { kind: 'light', id: light.id });
}

export function updateLight(id: string, patch: Partial<Omit<Light, 'id'>>) {
  setState('doc', 'lights', (l) => l.id === id, (l) => ({ ...l, ...patch }));
}

export function removeLight(id: string) {
  beginHistory();
  setState('doc', 'lights', (arr) => arr.filter((l) => l.id !== id));
  fixSelection();
}

/** 调节"离冰面距离":沿光线方向把灯移到距首个冰体 d 米处 */
export function setLightDistanceToIce(id: string, d: number) {
  const light = state.doc.lights.find((l) => l.id === id);
  if (!light) return;
  const hit = firstIceHit(light, state.doc.iceBlocks);
  if (!hit) return;
  const dir = lightDirection(light);
  const pos: Vec3 = [
    hit.point.x - dir.x * d,
    Math.max(0.1, hit.point.y - dir.y * d),
    hit.point.z - dir.z * d,
  ];
  updateLight(id, { position: pos });
}

/* ---------------- 组 ---------------- */

export function createGroup(lightIds: string[]) {
  if (!lightIds.length) return;
  beginHistory();
  const id = uid();
  setState(
    produce((s) => {
      s.doc.groups.push({ id, name: `灯组 ${s.doc.groups.length + 1}` });
      for (const l of s.doc.lights) {
        if (lightIds.includes(l.id)) l.groupId = id;
      }
    }),
  );
  setState('selection', { kind: 'group', id });
}

export function dissolveGroup(id: string) {
  beginHistory();
  setState(
    produce((s) => {
      s.doc.groups = s.doc.groups.filter((g) => g.id !== id);
      for (const l of s.doc.lights) {
        if (l.groupId === id) l.groupId = null;
      }
    }),
  );
  fixSelection();
}

export function groupMembers(groupId: string): Light[] {
  return state.doc.lights.filter((l) => l.groupId === groupId);
}

export function groupCentroid(groupId: string): Vec3 {
  const members = groupMembers(groupId);
  if (!members.length) return [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  for (const m of members) {
    c[0] += m.position[0];
    c[1] += m.position[1];
    c[2] += m.position[2];
  }
  return [c[0] / members.length, c[1] / members.length, c[2] / members.length];
}

/** 拖拽组手柄期间,直接写入成员的新位置/方位角(历史已在拖拽开始时记录) */
export function applyGroupTransform(updates: Array<{ id: string; position: Vec3; azimuth: number }>) {
  setState(
    produce((s) => {
      for (const u of updates) {
        const l = s.doc.lights.find((x) => x.id === u.id);
        if (l) {
          l.position = u.position;
          l.azimuth = u.azimuth;
        }
      }
    }),
  );
}

/** 绕组质心旋转(面板按钮用) */
export function rotateGroupBy(groupId: string, deltaDeg: number) {
  beginHistory();
  const c = groupCentroid(groupId);
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  setState(
    produce((s) => {
      for (const l of s.doc.lights) {
        if (l.groupId !== groupId) continue;
        const dx = l.position[0] - c[0];
        const dz = l.position[2] - c[2];
        l.position = [
          c[0] + dx * cos + dz * sin,
          l.position[1],
          c[2] - dx * sin + dz * cos,
        ];
        l.azimuth = l.azimuth + deltaDeg;
      }
    }),
  );
}

/* ---------------- 删除选中 ---------------- */

export function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.kind === 'ice') removeIce(sel.id);
  else if (sel.kind === 'light') removeLight(sel.id);
  else dissolveGroup(sel.id);
}

/* ---------------- 方案 ---------------- */

export function saveScheme(name: string) {
  const scheme: Scheme = { id: uid(), name, doc: JSON.parse(snap()) };
  setState('schemes', (arr) => [...arr, scheme]);
}

export function loadScheme(id: string) {
  const sc = state.schemes.find((s) => s.id === id);
  if (!sc) return;
  beginHistory();
  setState('doc', JSON.parse(JSON.stringify(sc.doc)));
  fixSelection();
}

export function deleteScheme(id: string) {
  setState('schemes', (arr) => arr.filter((s) => s.id !== id));
  if (state.compareA === id) setState('compareA', null);
  if (state.compareB === id) setState('compareB', null);
}

export function setCompare(slot: 'A' | 'B', id: string) {
  setState(slot === 'A' ? 'compareA' : 'compareB', id);
}

let abSide: 'A' | 'B' = 'B';
/** A/B 对比切换:轮流载入两个方案(可撤销,方便切回) */
export function toggleCompare() {
  const next = abSide === 'A' ? 'B' : 'A';
  const id = next === 'A' ? state.compareA : state.compareB;
  if (!id) return;
  abSide = next;
  loadScheme(id);
}

/* ---------------- 导入 / 导出 ---------------- */

export function exportFile() {
  const data = JSON.stringify(
    { app: 'ice-lantern-layout', version: 1, doc: state.doc, schemes: state.schemes },
    null,
    2,
  );
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ice-lighting-plan.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importFile(file: File) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !data.doc || !Array.isArray(data.doc.lights) || !Array.isArray(data.doc.iceBlocks)) {
    throw new Error('文件格式不正确');
  }
  beginHistory();
  setState('doc', { groups: [], ...data.doc });
  if (Array.isArray(data.schemes)) setState('schemes', data.schemes);
  fixSelection();
}

/* ---------------- 派生:透射路径(任何冰体/灯变化都会触发重算) ---------------- */

export const pathResults = createMemo(() => computeAllPaths(state.doc));

/* ---------------- 持久化 ---------------- */

export function initPersistence() {
  createEffect(() => {
    const data = JSON.stringify({ doc: state.doc, schemes: state.schemes });
    try {
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      /* 存储满时静默失败 */
    }
  });
}
