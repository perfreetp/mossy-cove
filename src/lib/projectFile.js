import { get } from 'svelte/store';
import { doc, history, normalizeDoc, replaceProject } from './store';

export function exportProjectFile() {
  const currentDoc = get(doc);
  const currentHistory = get(history);
  const payload = {
    app: 'micro-building-floor-splitter',
    format: 'micro-building-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    doc: currentDoc,
    history: currentHistory
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  anchor.href = url;
  anchor.download = `micro-building-${currentDoc.buildingId}-${currentDoc.floorCount}f-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickProjectFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    const cleanup = () => input.remove();
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(false);
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(false);
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const projectDoc = normalizeDoc(data.doc ?? data);
        replaceProject(projectDoc, data.history ?? null);
        resolve(true);
      } catch (error) {
        reject(error);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}
