/**
 * 浏览器本地数据仓（IndexedDB）。
 *
 * 点云以「数据仓条目」为单位存储：一个条目对应一次导入的 PotreeConverter
 * 输出目录（metadata.json + octree.bin + hierarchy.bin 等），每个文件以
 * Blob 形式存放在 pointcloud 表中，主键为 `${cloudKey}/${相对路径}`。
 *
 * 工程导出文件本身不强制入库（走下载/导入文件流程），但也提供保存槽位，
 * 便于在同一浏览器内复用。
 */

const DB_NAME = 'crime-scene-pcv-db';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META = 'clouds';

export interface CloudRecord {
  /** 唯一键，也是文件主键前缀 */
  key: string;
  name: string;
  /** 相对路径列表，例如 ["metadata.json", "octree.bin", "hierarchy.bin"] */
  files: string[];
  totalBytes: number;
  importedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const request = fn(t.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

function fileKey(cloudKey: string, relPath: string): string {
  const norm = relPath.replace(/^\/+/, '');
  return `${cloudKey}/${norm}`;
}

/** 列出本地已导入的点云 */
export async function listClouds(): Promise<CloudRecord[]> {
  const all = await tx(STORE_META, 'readonly', (s) => s.getAll() as IDBRequest<CloudRecord[]>);
  return all.sort((a, b) => b.importedAt - a.importedAt);
}

export async function getCloud(key: string): Promise<CloudRecord | undefined> {
  return tx(STORE_META, 'readonly', (s) => s.get(key) as IDBRequest<CloudRecord | undefined>);
}

/**
 * 导入一整个点云目录。
 * @param key 新条目键
 * @param files 相对路径 -> Blob
 */
export async function putCloud(
  key: string,
  name: string,
  files: Record<string, Blob>
): Promise<CloudRecord> {
  const db = await openDb();
  const relPaths = Object.keys(files).sort();
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_FILES, STORE_META], 'readwrite');
    t.onerror = () => reject(t.error);
    t.oncomplete = () => resolve();
    const fileStore = t.objectStore(STORE_FILES);
    for (const rel of relPaths) {
      const blob = files[rel];
      totalBytes += blob.size;
      fileStore.put(blob, fileKey(key, rel));
    }
    const record: CloudRecord = {
      key,
      name,
      files: relPaths,
      totalBytes,
      importedAt: Date.now()
    };
    t.objectStore(STORE_META).put(record);
  });

  return (await getCloud(key))!;
}

/** 读取点云内某个文件的 Blob，不存在时返回 undefined */
export async function getFile(cloudKey: string, relPath: string): Promise<Blob | undefined> {
  return tx(STORE_FILES, 'readonly', (s) =>
    s.get(fileKey(cloudKey, relPath)) as IDBRequest<Blob | undefined>
  );
}

/** 删除一个点云条目及其全部文件 */
export async function deleteCloud(key: string): Promise<void> {
  const record = await getCloud(key);
  if (!record) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_FILES, STORE_META], 'readwrite');
    t.onerror = () => reject(t.error);
    t.oncomplete = () => resolve();
    const fileStore = t.objectStore(STORE_FILES);
    for (const rel of record.files) fileStore.delete(fileKey(key, rel));
    t.objectStore(STORE_META).delete(key);
  });
}

/** 估算 IndexedDB 占用（字节），不支持时返回 null */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return null;
}

/** 从 Blob 创建对象 URL（集中管理，便于统一回收） */
export function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}
