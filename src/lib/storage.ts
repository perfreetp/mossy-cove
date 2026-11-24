import type { ProjectFile } from '../types';
import { serializedGeometries, store } from '../store';

const DB_NAME = 'bone-fragment-reassembly';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const CURRENT_KEY = 'current-project-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildProjectFile(): ProjectFile {
  return {
    app: 'bone-fragment-reassembly',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    projectName: store.projectName,
    fragments: clonePlain(store.fragments),
    groups: clonePlain(store.groups),
    pairs: clonePlain(store.pairs),
    settings: clonePlain(store.settings),
    geometries: store.fragments
      .map((fragment) => serializedGeometries.get(fragment.geometryId))
      .filter((geometry): geometry is NonNullable<typeof geometry> => Boolean(geometry)),
    lastRegistration: store.report ? clonePlain(store.report) : null,
  };
}

export async function saveProjectLocally(): Promise<void> {
  await idbSet(CURRENT_KEY, buildProjectFile());
  store.lastSavedAt = Date.now();
  store.saveState = 'saved';
}

export async function loadLocalProject(): Promise<ProjectFile | null> {
  try {
    return (await idbGet<ProjectFile>(CURRENT_KEY)) ?? null;
  } catch (error) {
    console.warn('读取本地项目失败', error);
    store.storageAvailable = false;
    return null;
  }
}

export async function clearLocalProject(): Promise<void> {
  await idbDelete(CURRENT_KEY);
}
