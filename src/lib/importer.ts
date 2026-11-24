import { putCloud, type CloudRecord } from './db';
import { uid } from './util';

/**
 * 点云导入：
 * - PotreeConverter 2.x：目录内含 metadata.json + octree.bin + hierarchy.bin
 * - PotreeConverter 1.x：cloud.js + data/ 目录
 * 整个目录原样写入 IndexedDB，键路径保持相对结构，LocalRequestManager 按路径取回。
 */

export interface ImportResult {
  record: CloudRecord;
  format: '2.x' | '1.x';
  warnings: string[];
}

/** 从 <input webkitdirectory> 或拖拽 FileList 中抽取「相对路径 -> File」 */
export function filesFromList(list: FileList | File[]): Record<string, File> {
  const out: Record<string, File> = {};
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (rel && rel.includes('/')) {
      // 去掉最顶层的目录名（用户选择的文件夹名）
      const idx = rel.indexOf('/');
      out[rel.slice(idx + 1).replace(/\\/g, '/')] = file;
    } else {
      out[file.name] = file;
    }
  }
  return out;
}

export async function importPointCloud(
  files: Record<string, File>,
  displayName?: string
): Promise<ImportResult> {
  const paths = Object.keys(files);
  const warnings: string[] = [];

  const has2x = paths.some((p) => p.endsWith('metadata.json'));
  const has1x = paths.some((p) => p.endsWith('cloud.js'));

  if (!has2x && !has1x) {
    throw new Error('未找到 metadata.json（PotreeConverter 2.x）或 cloud.js（1.x），请选择转换器输出的整个文件夹');
  }
  const format: '2.x' | '1.x' = has2x ? '2.x' : '1.x';

  // 归一化为 Blob 映射（File 本身即 Blob）
  const blobs: Record<string, Blob> = {};
  let rootPrefix = '';
  if (has2x) {
    const meta = paths.find((p) => p.endsWith('metadata.json'))!;
    rootPrefix = meta.slice(0, meta.length - 'metadata.json'.length);
  } else {
    const cjs = paths.find((p) => p.endsWith('cloud.js'))!;
    rootPrefix = cjs.slice(0, cjs.length - 'cloud.js'.length);
  }

  for (const p of paths) {
    if (!p.startsWith(rootPrefix)) continue;
    const rel = p.slice(rootPrefix.length);
    if (!rel) continue;
    blobs[rel] = files[p];
  }

  if (format === '2.x') {
    for (const required of ['octree.bin', 'hierarchy.bin']) {
      if (!blobs[required]) warnings.push(`缺少推荐文件 ${required}，点云可能无法正常加载`);
    }
  }

  const key = uid('cloud');
  const name = displayName ?? (rootPrefix.replace(/\/$/, '') || '未命名点云');
  const record = await putCloud(key, name, blobs);
  return { record, format, warnings };
}
