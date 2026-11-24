// 项目导出 / 导入：JSON 文件分享（模型资产以 data URL 内嵌）
import type { ProjectData } from '../types';
import { uid } from './math';

export const EXPORT_VERSION = 1;

export function exportProjectFile(data: ProjectData): void {
  const payload = {
    format: 'ballistic-trajectory-recon',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: sanitize(data),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.name || 'ballistic-scene'}-${new Date().toISOString().slice(0, 10)}.btr.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 剥离渲染期临时字段，保证导出内容只含点位、采样点与遮挡判定结果 */
function sanitize(data: ProjectData): ProjectData {
  return {
    version: data.version,
    name: data.name,
    updatedAt: data.updatedAt,
    activeTrajectoryId: data.activeTrajectoryId,
    points: data.points.map((p) => ({ ...p, position: [...p.position], direction: [...p.direction] })),
    obstacles: data.obstacles.map((o) => ({ ...o, position: [...o.position], rotation: [...o.rotation], halfExtents: [...o.halfExtents] })),
    trajectories: data.trajectories.map((t) => ({
      ...t,
      pointIds: [...t.pointIds],
      samples: t.samples.map((s) => [...s] as [number, number, number]),
      occlusions: t.occlusions.map((oc) => ({
        ...oc,
        enterPosition: [...oc.enterPosition] as [number, number, number],
        exitPosition: [...oc.exitPosition] as [number, number, number],
      })),
    })),
    assets: data.assets.map((a) => ({ ...a, halfExtents: [...a.halfExtents] })),
  };
}

export function readProjectFile(file: File): Promise<ProjectData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        resolve(validate(parsed));
      } catch (e) {
        reject(new Error(`文件解析失败：${(e as Error).message}`));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

function validate(raw: unknown): ProjectData {
  if (typeof raw !== 'object' || raw === null) throw new Error('不是有效的项目文件');
  const wrapper = raw as Record<string, unknown>;
  const project = (wrapper.format === 'ballistic-trajectory-recon' ? wrapper.project : raw) as
    | Record<string, unknown>
    | undefined;
  if (!project || !Array.isArray(project.points) || !Array.isArray(project.obstacles)) {
    throw new Error('缺少 points / obstacles 字段，文件结构不兼容');
  }
  const data = project as unknown as ProjectData;
  // 重新生成 id 防止与当前场景冲突由调用方决定；这里仅保证字段完整
  if (!Array.isArray(data.trajectories)) data.trajectories = [];
  if (!Array.isArray(data.assets)) data.assets = [];
  for (const t of data.trajectories) {
    if (!Array.isArray(t.samples)) t.samples = [];
    if (!Array.isArray(t.occlusions)) t.occlusions = [];
    if (typeof t.bendLevel !== 'number') t.bendLevel = 3;
    if (typeof t.snap !== 'boolean') t.snap = true;
  }
  void uid;
  return data;
}

/** 导入时重映射所有 id，避免与当前项目冲突 */
export function rekeyProject(data: ProjectData): ProjectData {
  const pointMap = new Map<string, string>();
  const obstacleMap = new Map<string, string>();
  const assetMap = new Map<string, string>();
  const trajMap = new Map<string, string>();
  data.points.forEach((p) => pointMap.set(p.id, uid('pt')));
  data.obstacles.forEach((o) => {
    const nid = uid('ob');
    obstacleMap.set(o.id, nid);
    if (o.assetId) assetMap.set(o.assetId, uid('ast'));
  });
  data.assets.forEach((a) => {
    if (!assetMap.has(a.id)) assetMap.set(a.id, uid('ast'));
  });
  data.trajectories.forEach((t) => trajMap.set(t.id, uid('tj')));

  return {
    ...data,
    points: data.points.map((p) => ({ ...p, id: pointMap.get(p.id)! })),
    assets: data.assets.map((a) => ({ ...a, id: assetMap.get(a.id) ?? uid('ast') })),
    obstacles: data.obstacles.map((o) => ({
      ...o,
      id: obstacleMap.get(o.id)!,
      assetId: o.assetId ? assetMap.get(o.assetId) : undefined,
    })),
    trajectories: data.trajectories.map((t) => ({
      ...t,
      id: trajMap.get(t.id)!,
      pointIds: t.pointIds.map((id) => pointMap.get(id) ?? id),
      occlusions: t.occlusions.map((oc) => ({
        ...oc,
        obstacleId: obstacleMap.get(oc.obstacleId) ?? oc.obstacleId,
      })),
    })),
    activeTrajectoryId: data.activeTrajectoryId
      ? trajMap.get(data.activeTrajectoryId) ?? null
      : null,
  };
}
