import type { SceneProject } from '../types';
import { getCloud, getFile, listClouds } from './db';

const MAGIC = 'CSPCV1';

/**
 * 导出文件采用自定义容器（.cspcv）：
 *   第 1 行：魔数 CSPCV1
 *   第 2 行：清单 JSON（含 project 与各内嵌文件的偏移/长度）
 *   之后：按清单顺序拼接的二进制文件（点云数据，可选）
 *
 * 纯工程（不含点云）也可以只导出 JSON 部分，用 .json 后缀。
 */
interface ManifestEntry {
  path: string;
  offset: number;
  length: number;
}

interface Manifest {
  magic: string;
  project: SceneProject;
  embedded: ManifestEntry[];
}

export interface ExportOptions {
  /** 是否把本地点云数据一并打包（文件会很大） */
  includePointCloud: boolean;
}

/** 导出工程；返回可下载的 Blob 与建议文件名 */
export async function exportProject(
  project: SceneProject,
  options: ExportOptions
): Promise<{ blob: Blob; filename: string }> {
  const embedded: ManifestEntry[] = [];
  const chunks: Blob[] = [];
  let cursor = 0;

  if (options.includePointCloud && project.cloudKey) {
    const record = await getCloud(project.cloudKey);
    if (record) {
      for (const rel of record.files) {
        const fileBlob = await getFileBlob(project.cloudKey, rel);
        if (!fileBlob) continue;
        embedded.push({ path: rel, offset: cursor, length: fileBlob.size });
        chunks.push(fileBlob);
        cursor += fileBlob.size;
      }
    }
  }

  const manifest: Manifest = { magic: MAGIC, project, embedded };
  const manifestJson = JSON.stringify(manifest);
  const header = `${MAGIC}\n${manifestJson}\n`;
  const headerBlob = new Blob([header], { type: 'application/json' });

  const blob = new Blob([headerBlob, ...chunks], {
    type: 'application/octet-stream'
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = project.cloudName ? `${project.cloudName}-${stamp}` : `现场工程-${stamp}`;
  return { blob, filename: `${name}.cspcv` };
}

async function getFileBlob(cloudKey: string, rel: string): Promise<Blob | null> {
  return (await getFile(cloudKey, rel)) ?? null;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface ParsedProjectFile {
  project: SceneProject;
  /** 容器中内嵌的点云文件（相对路径 -> Blob），纯 JSON 工程时为空 */
  embeddedFiles: Record<string, Blob>;
  isContainer: boolean;
}

/** 解析导入的工程文件（支持 .cspcv 容器与纯 .json 两种） */
export async function parseProjectFile(file: File): Promise<ParsedProjectFile> {
  const buffer = await file.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength)));

  if (head.startsWith(MAGIC)) {
    // 容器格式：定位第二个换行符
    const bytes = new Uint8Array(buffer);
    const nl1 = indexOfByte(bytes, 0x0a, 0);
    const nl2 = indexOfByte(bytes, 0x0a, nl1 + 1);
    if (nl1 < 0 || nl2 < 0) throw new Error('工程文件头部损坏');
    const manifestText = new TextDecoder().decode(bytes.subarray(nl1 + 1, nl2));
    const manifest = JSON.parse(manifestText) as Manifest;
    if (manifest.magic !== MAGIC) throw new Error('工程文件魔数不匹配');
    const base = nl2 + 1;
    const embeddedFiles: Record<string, Blob> = {};
    for (const entry of manifest.embedded) {
      embeddedFiles[entry.path] = new Blob([buffer.slice(base + entry.offset, base + entry.offset + entry.length)]);
    }
    return { project: manifest.project, embeddedFiles, isContainer: true };
  }

  // 纯 JSON
  const json = JSON.parse(await file.text()) as SceneProject;
  if (json.format !== 'crime-scene-pcv') throw new Error('无法识别的工程文件格式');
  return { project: json, embeddedFiles: {}, isContainer: false };
}

function indexOfByte(bytes: Uint8Array, target: number, from: number): number {
  for (let i = Math.max(0, from); i < bytes.length; i++) {
    if (bytes[i] === target) return i;
  }
  return -1;
}

/** 检查工程引用的点云在本地是否已存在（按 cloudKey 或同名记录匹配） */
export async function findLocalCloud(project: SceneProject): Promise<{
  exact: boolean;
  cloudKey?: string;
}> {
  if (!project.cloudKey) return { exact: false };
  const clouds = await listClouds();
  const exact = clouds.find((c) => c.key === project.cloudKey);
  if (exact) return { exact: true, cloudKey: exact.key };
  const sameName = clouds.find((c) => c.name === project.cloudName);
  if (sameName) return { exact: false, cloudKey: sameName.key };
  return { exact: false };
}
