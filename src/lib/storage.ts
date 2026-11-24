// IndexedDB 本地持久化（自动保存 + 草稿恢复）
import type { ProjectData } from '../types';

const DB_NAME = 'ballistic-recon-db';
const STORE = 'projects';
const KEY = 'current';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export async function saveProject(data: ProjectData): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...data, updatedAt: Date.now() }, KEY));
}

export async function loadProject(): Promise<ProjectData | null> {
  try {
    const result = await tx<ProjectData | undefined>('readonly', (s) => s.get(KEY));
    return result ?? null;
  } catch {
    return null;
  }
}

export async function clearProject(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY));
}
