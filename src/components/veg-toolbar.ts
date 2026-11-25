import { BRUSH_LABELS } from '../core/config';
import { app } from '../core/context';
import { uiState } from '../core/ui-state';
import { getSharedSheet } from './shared-styles';

const ICONS = {
  pan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1.5v-4a1.5 1.5 0 0 1 3 0V12m0-1v-2a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-.8a6 6 0 0 1-4.7-2.3L3 15.6a1.6 1.6 0 0 1 2.4-2.1L8 16"/></svg>`,
  zone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="4 3"/><path d="M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3"/></svg>`,
  erase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16.5 3.5 4 4a2 2 0 0 1 0 2.8L11 19.8a2 2 0 0 1-1.4.6H5l-2.3-2.3a2 2 0 0 1 0-2.8l11-11.8a2 2 0 0 1 2.8 0Z"/><path d="m8 9 7 7M9 21h12"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>`,
  export: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  import: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0 4 4m-4-4L8 7"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
};

export class VegToolbar extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [getSharedSheet()];
    root.innerHTML = `
      <div class="toolbar-root">
        <div class="tool-group" role="group" aria-label="工具">
          <button class="tool-btn" data-tool="pan" data-testid="tool-pan" title="平移视口 (V)">${ICONS.pan}<span>平移</span></button>
          <button class="tool-btn" data-tool="zone" data-testid="tool-zone" title="划定散布区域 (R)">${ICONS.zone}<span>划定区域</span></button>
          <button class="tool-btn" data-tool="erase" data-testid="tool-erase" title="擦除植被 (E)">${ICONS.erase}<span>擦除</span></button>
        </div>
        <div class="tool-divider"></div>
        <div class="tool-group" data-testid="brush-group" title="擦除笔刷半径（[ / ] 切换）">
          <div class="brush-seg" role="group" aria-label="笔刷档位">
            ${BRUSH_LABELS.map(
              (label, i) => `
              <button data-brush="${i}" data-testid="brush-size-${i}" aria-pressed="${i === 1}">
                <span class="brush-size-dot" style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span>${label}
              </button>`,
            ).join('')}
          </div>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="tool-group">
          <button class="btn icon" id="undo-btn" data-testid="undo-btn" title="撤销 (Ctrl+Z)" disabled>${ICONS.undo}</button>
          <button class="btn icon" id="redo-btn" data-testid="redo-btn" title="重做 (Ctrl+Shift+Z)" disabled>${ICONS.redo}</button>
        </div>
        <div class="tool-divider"></div>
        <div class="tool-group">
          <button class="btn" id="import-btn" data-testid="import-btn">${ICONS.import}<span>导入</span></button>
          <button class="btn primary" id="export-btn" data-testid="export-btn">${ICONS.export}<span>导出散布</span></button>
        </div>
      </div>
    `;

    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => app.controller?.setTool(btn.dataset.tool as never));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((btn) => {
      btn.addEventListener('click', () =>
        app.controller?.setBrushTier(Number(btn.dataset.brush)),
      );
    });
    root.getElementById('undo-btn')?.addEventListener('click', () => app.controller?.undo());
    root.getElementById('redo-btn')?.addEventListener('click', () => app.controller?.redo());
    root.getElementById('export-btn')?.addEventListener('click', () => app.controller?.exportProject());
    root.getElementById('import-btn')?.addEventListener('click', () => app.controller?.triggerImport());
  }

  connectedCallback(): void {
    const root = this.shadowRoot!;
    uiState.subscribe((s) => {
      root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.tool === s.tool));
      });
      root.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.brush) === s.brushTier));
      });
    });

    const refreshHistory = () => {
      const store = app.store;
      const undo = root.getElementById('undo-btn') as HTMLButtonElement;
      const redo = root.getElementById('redo-btn') as HTMLButtonElement;
      if (!store) return;
      undo.disabled = !store.canUndo;
      redo.disabled = !store.canRedo;
      undo.title = store.undoLabel ? `撤销：${store.undoLabel} (Ctrl+Z)` : '撤销 (Ctrl+Z)';
      redo.title = store.redoLabel ? `重做：${store.redoLabel} (Ctrl+Y)` : '重做 (Ctrl+Y)';
    };
    // store 在 constructor 之后由 main 注入，用微任务 + 订阅轮询一次
    const trySubscribe = () => {
      if (app.store) {
        app.store.subscribe(refreshHistory);
        refreshHistory();
      } else {
        queueMicrotask(trySubscribe);
      }
    };
    trySubscribe();
  }
}

customElements.define('veg-toolbar', VegToolbar);
