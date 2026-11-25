import { ELEVATION_MAX_M } from '../core/config';
import { app } from '../core/context';
import { countInstances } from '../core/actions';
import { getSharedSheet } from './shared-styles';

const RES = 1000;
const MIN_GAP = 18;

/** 高度带控制条：双滑块限定海拔区间，区间外实例回收到对象池 */
export class HeightBandControl extends HTMLElement {
  private gesturing = false;
  private lastTerrainSeed = -1;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [getSharedSheet()];
    root.innerHTML = `
      <style>
        .band-dim { position: absolute; top: 6px; bottom: 12px; background: rgba(8,13,20,.66);
          border-radius: 5px; pointer-events: none; }
        .band-dim.left { left: 0; }
        .band-dim.right { right: 0; }
      </style>
      <div class="band-shell">
        <div class="band-head">
          <span class="band-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7fc6ef" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 19 6-11 4 7 2-3 6 7H3Z"/></svg>
            高度带控制
          </span>
          <div class="band-values">
            <span class="band-chip"><b data-low-m>0 m</b> 起</span>
            <span class="band-chip"><b data-high-m>${ELEVATION_MAX_M} m</b> 止</span>
            <span class="band-chip out" data-testid="band-hidden-chip">池内回收 <b data-hidden-count>0</b></span>
            <button class="btn sm" data-reset-band data-testid="band-reset">重置</button>
          </div>
        </div>
        <div class="band-track-wrap">
          <canvas class="band-hist" data-testid="band-hist"></canvas>
          <div class="band-dim left" data-dim-left></div>
          <div class="band-dim right" data-dim-right></div>
          <div class="band-range-line"><div class="band-range-fill" data-range-fill></div></div>
          <input class="dual low" type="range" min="0" max="${RES}" step="1" value="0"
            data-testid="band-low" aria-label="高度带下限" />
          <input class="dual high" type="range" min="0" max="${RES}" step="1" value="${RES}"
            data-testid="band-high" aria-label="高度带上限" />
        </div>
        <div class="band-scale">
          <span>0 m · 水岸</span><span>拖动两个滑块限定保留的海拔区间</span><span>${ELEVATION_MAX_M} m · 雪峰</span>
        </div>
      </div>
    `;

    const low = root.querySelector<HTMLInputElement>('[data-testid="band-low"]')!;
    const high = root.querySelector<HTMLInputElement>('[data-testid="band-high"]')!;

    const onInput = () => {
      if (!this.gesturing) {
        this.gesturing = true;
        app.controller?.beginBandGesture();
      }
      let lo = Number(low.value);
      let hi = Number(high.value);
      if (lo > hi - MIN_GAP) {
        // 推动另一个滑块，避免两柄交叉
        if (document.activeElement === low) hi = Math.min(RES, lo + MIN_GAP);
        else lo = Math.max(0, hi - MIN_GAP);
        low.value = String(lo);
        high.value = String(hi);
      }
      app.controller?.updateBand(lo / RES, hi / RES);
    };
    low.addEventListener('input', onInput);
    high.addEventListener('input', onInput);
    const commit = () => {
      if (this.gesturing) {
        this.gesturing = false;
        app.controller?.commitBandGesture();
      }
    };
    low.addEventListener('change', commit);
    high.addEventListener('change', commit);

    root.querySelector('[data-reset-band]')?.addEventListener('click', () => {
      app.controller?.resetBand();
    });
  }

  connectedCallback(): void {
    const tryBind = () => {
      if (!app.store) return queueMicrotask(tryBind);
      app.store.subscribe(() => this.refresh());
      this.refresh();
    };
    tryBind();
  }

  private drawHistogram(): void {
    const hf = app.hf;
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>('[data-testid="band-hist"]');
    if (!hf || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 28;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const bins = hf.histogram(64);
    const max = Math.max(...bins, 1);
    const bw = cssW / bins.length;
    const grad = ctx.createLinearGradient(0, 0, cssW, 0);
    grad.addColorStop(0, 'rgba(90,176,239,.85)');
    grad.addColorStop(0.35, 'rgba(95,208,138,.85)');
    grad.addColorStop(0.7, 'rgba(226,164,85,.85)');
    grad.addColorStop(1, 'rgba(230,236,245,.9)');
    ctx.fillStyle = grad;
    bins.forEach((v, i) => {
      const h = Math.max(2, (v / max) * cssH);
      ctx.globalAlpha = 0.5 + 0.5 * (v / max);
      ctx.fillRect(i * bw, cssH - h, Math.max(1, bw - 0.6), h);
    });
    ctx.globalAlpha = 1;
  }

  private refresh(): void {
    const s = app.store?.state;
    if (!s || !this.shadowRoot) return;
    const root = this.shadowRoot;

    if (app.hf && app.hf.seed !== this.lastTerrainSeed) {
      this.lastTerrainSeed = app.hf.seed;
      requestAnimationFrame(() => this.drawHistogram());
    }

    const loV = Math.round(s.bandLow * RES);
    const hiV = Math.round(s.bandHigh * RES);
    const low = root.querySelector<HTMLInputElement>('[data-testid="band-low"]')!;
    const high = root.querySelector<HTMLInputElement>('[data-testid="band-high"]')!;
    if (document.activeElement !== low) low.value = String(loV);
    if (document.activeElement !== high) high.value = String(hiV);

    root.querySelector('[data-low-m]')!.textContent = `${Math.round(s.bandLow * ELEVATION_MAX_M)} m`;
    root.querySelector('[data-high-m]')!.textContent = `${Math.round(s.bandHigh * ELEVATION_MAX_M)} m`;

    const fill = root.querySelector<HTMLElement>('[data-range-fill]')!;
    fill.style.left = `${s.bandLow * 100}%`;
    fill.style.width = `${(s.bandHigh - s.bandLow) * 100}%`;
    (root.querySelector('[data-dim-left]') as HTMLElement).style.width = `${s.bandLow * 100}%`;
    (root.querySelector('[data-dim-right]') as HTMLElement).style.width = `${(1 - s.bandHigh) * 100}%`;

    const counts = countInstances(s);
    const hidden = counts.trees + counts.bushes - counts.visible;
    root.querySelector('[data-hidden-count]')!.textContent = String(hidden);
  }
}

customElements.define('height-band-control', HeightBandControl);
