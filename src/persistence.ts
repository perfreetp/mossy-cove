import type { SavedDoc } from './types';

const STORAGE_KEY = 'mortise-tenon-tool/doc/v1';

export function saveToLocal(doc: SavedDoc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch (err) {
    // 隐私模式或配额超限时静默降级,导出仍可用
    console.warn('本地保存失败:', err);
  }
}

export function loadFromLocal(): SavedDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as SavedDoc;
    if (doc.version !== 1 || !doc.planes || !Array.isArray(doc.annotations)) return null;
    return doc;
  } catch (err) {
    console.warn('本地文档读取失败:', err);
    return null;
  }
}

export function exportDoc(doc: SavedDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `mortise-tenon-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importDoc(file: File): Promise<SavedDoc> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result)) as SavedDoc;
        if (doc.version !== 1 || !doc.planes || !Array.isArray(doc.annotations)) {
          throw new Error('文件内容不符合工具文档格式');
        }
        resolve(doc);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('文件解析失败'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
