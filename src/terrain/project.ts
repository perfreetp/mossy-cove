import {
  DEFAULT_RESOLUTION, DEFAULT_SECTIONS, DEFAULT_STRATA_BOUNDARIES, STORAGE_KEY, WORLD_SIZE
} from './config';
import { generateHeightField } from './heightfield';
import type { Building, ProjectData } from './types';

export function createDefaultProject(name = '未命名沙盘'): ProjectData {
  const resolution = DEFAULT_RESOLUTION;
  const heights = generateHeightField(resolution);
  return {
    format: 'micro-sandbox-terrain',
    version: 1,
    name,
    resolution,
    cellSize: WORLD_SIZE / resolution,
    heightField: Array.from(heights, (v) => Math.round(v * 1000) / 1000),
    buildings: [],
    waterLevel: 0.55,
    waterEnabled: true,
    showContours: true,
    strataBoundaries: [...DEFAULT_STRATA_BOUNDARIES],
    sections: { ...DEFAULT_SECTIONS }
  };
}

function normalizeBuilding(raw: unknown, index: number): Building | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    id: typeof b.id === 'string' ? b.id : `imported_${index}_${Math.random().toString(36).slice(2, 7)}`,
    x: num(b.x, 0),
    z: num(b.z, 0),
    width: Math.max(0.12, num(b.width, 0.8)),
    depth: Math.max(0.12, num(b.depth, 0.8)),
    height: Math.max(0.12, num(b.height, 1.4)),
    rotation: num(b.rotation, 0),
    color: typeof b.color === 'string' ? b.color : '#bcccdc'
  };
}

export function parseProjectData(text: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!raw || typeof raw !== 'object') throw new Error('JSON 根节点必须是对象');
  const r = raw as Record<string, unknown>;

  const resolution = Number(r.resolution ?? (r.heightField as Record<string, unknown> | undefined)?.resolution);
  if (!Number.isInteger(resolution) || resolution < 16 || resolution > 512) {
    throw new Error('resolution 必须是 16–512 的整数');
  }

  let field: unknown = r.heightField ?? r.heights;
  if (field && !Array.isArray(field) && typeof field === 'object') {
    field = (field as Record<string, unknown>).heights;
  }
  if (!Array.isArray(field)) throw new Error('缺少 heightField 高度场数组');
  const expected = (resolution + 1) ** 2;
  if (field.length !== expected) {
    throw new Error(`高度场长度应为 ${expected}，实际为 ${field.length}`);
  }
  const heightField = field.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('高度场包含非数值');
    return n;
  });

  const rawBuildings = Array.isArray(r.buildings) ? r.buildings : [];
  const buildings = rawBuildings
    .map(normalizeBuilding)
    .filter((b): b is Building => b !== null)
    .slice(0, 5000);

  const rawSections = (r.sections ?? {}) as Partial<ProjectData['sections']>;
  const rawBoundaries = Array.isArray(r.strataBoundaries) ? r.strataBoundaries : DEFAULT_STRATA_BOUNDARIES;
  const strataBoundaries = DEFAULT_STRATA_BOUNDARIES.map((d, i) => {
    const n = Number(rawBoundaries[i]);
    return Number.isFinite(n) ? n : d;
  });

  return {
    format: 'micro-sandbox-terrain',
    version: 1,
    name: typeof r.name === 'string' ? r.name : '导入的沙盘',
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : undefined,
    resolution,
    cellSize: WORLD_SIZE / resolution,
    heightField,
    buildings,
    waterLevel: Number.isFinite(Number(r.waterLevel)) ? Number(r.waterLevel) : 0.55,
    waterEnabled: typeof r.waterEnabled === 'boolean' ? r.waterEnabled : true,
    showContours: typeof r.showContours === 'boolean' ? r.showContours : true,
    strataBoundaries,
    sections: { ...DEFAULT_SECTIONS, ...rawSections }
  };
}

export function loadStoredProject(): ProjectData | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parseProjectData(text) : null;
  } catch (error) {
    console.warn('读取自动存档失败', error);
    return null;
  }
}

export function saveStoredProject(project: ProjectData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch (error) {
    console.warn('自动存档失败', error);
    return false;
  }
}

export function clearStoredProject(): void {
  localStorage.removeItem(STORAGE_KEY);
}
