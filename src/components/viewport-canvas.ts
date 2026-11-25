import { app } from '../core/context';
import { TOOL_HINTS } from '../core/config';
import { uiState } from '../core/ui-state';
import { getSharedSheet } from './shared-styles';

/** 画布视口：承载 Pixi canvas，并提供悬浮缩放控件与操作提示 */
export class ViewportCanvas extends HTMLElement {
  readonly stageEl: HTMLDivElement;
  private hintEl: HTMLSpanElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [getSharedSheet()];
    root.innerHTML = `
      <style>
        :host { display: block; position: absolute; inset: 0; overflow: hidden; background: #10171f; }
        .stage { position: absolute; inset: 0; }
        .stage canvas { display: block; }
      </style>
      <div class="stage" data-testid="pixi-stage"></div>
      <div class="hint-chip" data-testid="tool-hint"><span class="pulse"></span><span class="hint-text"></span></div>
      <div class="zoom-cluster">
        <button class="zoom-btn" data-zoom="in" title="放大" data-testid="zoom-in">+</button>
        <button class="zoom-btn" data-zoom="reset" title="适配全图" data-testid="zoom-reset" style="font-size:13px">⊙</button>
        <button class="zoom-btn" data-zoom="out" title="缩小" data-testid="zoom-out">−</button>
      </div>
    `;
    this.stageEl = root.querySelector('.stage') as HTMLDivElement;
    this.hintEl = root.querySelector('.hint-text');

    root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const z = btn.dataset.zoom;
        if (z === 'in') app.scene?.zoomBy(1.25);
        else if (z === 'out') app.scene?.zoomBy(0.8);
        else app.scene?.resetView();
      });
    });
  }

  connectedCallback(): void {
    uiState.subscribe((s) => {
      if (this.hintEl) this.hintEl.textContent = TOOL_HINTS[s.tool] ?? '';
    });
  }
}

customElements.define('viewport-canvas', ViewportCanvas);
