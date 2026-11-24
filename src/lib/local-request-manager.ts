import type { RequestManager } from 'potree-core/dist/loading2/RequestManager';
import { getFile } from './db';

/**
 * 让 potree-core 从 IndexedDB 本地数据仓加载点云的 RequestManager。
 *
 * potree 加载 2.x 数据时会请求：
 *   <base>/metadata.json、<base>/hierarchy.bin、<base>/octree.bin（带 Range 头）
 * 本实现把这些 URL 映射回数据仓中的 Blob，并自行处理 Range 切片，
 * 浏览器对 blob: URL 的 Range 支持不一致，不能依赖原生响应。
 *
 * 所有 URL 都挂在虚拟源 `local://<cloudKey>/` 下，方便解析相对路径。
 */
export const LOCAL_SCHEME = 'local://';

export function buildLocalUrl(cloudKey: string, relPath: string): string {
  return `${LOCAL_SCHEME}${cloudKey}/${relPath.replace(/^\/+/, '')}`;
}

/** 从 potree 使用的 URL 中解析出 (cloudKey, 相对路径) */
export function parseLocalUrl(url: string): { cloudKey: string; relPath: string } | null {
  if (!url.startsWith(LOCAL_SCHEME)) return null;
  const rest = url.slice(LOCAL_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return { cloudKey: rest.slice(0, slash), relPath: rest.slice(slash + 1) };
}

function parseRangeHeader(init?: RequestInit): { start: number; end: number } | null {
  const headers = init?.headers as Record<string, string> | Headers | undefined;
  let range: string | null = null;
  if (!headers) return null;
  if (headers instanceof Headers) range = headers.get('Range');
  else range = headers['Range'] ?? headers['range'] ?? null;
  if (!range) return null;
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : null;
  return { start, end: end ?? Number.POSITIVE_INFINITY };
}

export class LocalRequestManager implements RequestManager {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = parseLocalUrl(url);
    if (!parsed) {
      // 非本地 URL 走标准网络通道（保留扩展性）
      return fetch(input as RequestInfo, init);
    }

    const blob = await getFile(parsed.cloudKey, parsed.relPath);
    if (!blob) {
      return new Response(null, { status: 404, statusText: `本地缺少文件: ${parsed.relPath}` });
    }

    const range = parseRangeHeader(init);
    if (range) {
      const end = Math.min(range.end === Number.POSITIVE_INFINITY ? blob.size - 1 : range.end, blob.size - 1);
      const slice = blob.slice(range.start, end + 1, blob.type);
      // potree 只调用 arrayBuffer()，状态码与 Content-Range 仅用于语义完整
      return new Response(slice, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${range.start}-${end}/${blob.size}`,
          'Content-Length': String(slice.size),
          'Accept-Ranges': 'bytes'
        }
      });
    }
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Length': String(blob.size) }
    });
  }

  async getUrl(url: string): Promise<string> {
    // 本地 URL 无需重写，直接透传
    return url;
  }
}
