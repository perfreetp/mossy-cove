import { DENSITY_CONFIG, DENSITY_ORDER, SPACING } from '../core/config';
import { app } from '../core/context';
import type { ProjectState } from '../core/types';
import { getSharedSheet } from './shared-styles';

/** 散布参数面板：密度档位、最小间距、乔灌比例、区域列表 */
export class ScatterPanel extends HTMLElement {
  private gesturing = false;
  private lastZoneSig = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [getSharedSheet()];
    root.innerHTML = `
      <div class="panel-inner">
        <section>
          <h3 class="section-title">散布密度 <span class="sub" data-testid="density-hint"></span></h3>
          <div class="seg" data-testid="density-group" role="group">
            ${DENSITY_ORDER.map(
              (d) =>
                `<button data-density="${d}" data-testid="density-${d}" aria-pressed="false">${DENSITY_CONFIG[d].label}</button>`,
            ).join('')}
          </div>
        </section>

        <section>
          <div class="slider-row">
            <div class="slider-head">
              <label for="spacing">最小间距</label>
              <output id="spacing-out" data-testid="spacing-value">${SPACING.default} px</output>
            </div>
            <input id="spacing" class="slider" type="range" data-testid="spacing-slider"
              min="${SPACING.min}" max="${SPACING.max}" step="${SPACING.step}" value="${SPACING.default}" />
          </div>

          <div class="slider-row">
            <div class="slider-head">
              <label for="ratio">树木 / 灌木比例</label>
              <output id="ratio-out" data-testid="ratio-value">55%</output>
            </div>
            <input id="ratio" class="slider" type="range" data-testid="ratio-slider"
              min="0" max="100" step="1" value="55" />
            <div class="ratio-bar"><div class="tree" data-ratio-tree></div><div class="bush" data-ratio-bush></div></div>
            <div class="ratio-labels"><span>树木 <b data-ratio-tree-label>55%</b></span><span><b data-ratio-bush-label>45%</b> 灌木</span></div>
          </div>
        </section>

        <section>
          <button class="btn primary block" id="regenerate-all" data-testid="regenerate-all">
            ⟳ 整片区域重新散布
          </button>
        </section>

        <div class="hint-box">
          散布会自动采样地形：<b>陡坡</b>与<b>高海拔</b>位置按概率变稀疏，
          越过雪线 / 极限坡度或处于水下则不放植株。
        </div>

        <section>
          <h3 class="section-title">散布区域 <span class="sub" data-zone-count></span></h3>
          <div class="zone-list" data-testid="zone-list"></div>
        </section>
      </div>
    `;

    const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;

    root.querySelectorAll<HTMLButtonElement>('[data-density]').forEach((btn) => {
      btn.addEventListener('click', () =>
        app.controller?.setDensity(btn.dataset.density as never),
      );
    });

    const spacing = $<HTMLInputElement>('#spacing');
    spacing.addEventListener('input', () => {
      this.beginGesture();
      app.controller?.updateParams({ minSpacing: Number(spacing.value) });
    });
    spacing.addEventListener('change', () => this.commitGesture());

    const ratio = $<HTMLInputElement>('#ratio');
    ratio.addEventListener('input', () => {
      this.beginGesture();
      app.controller?.updateParams({ treeRatio: Number(ratio.value) / 100 });
    });
    ratio.addEventListener('change', () => this.commitGesture());

    $('#regenerate-all').addEventListener('click', () => app.controller?.regenerateAll());
  }

  private beginGesture(): void {
    if (!this.gesturing) {
      this.gesturing = true;
      app.controller?.beginParamGesture();
    }
  }

  private commitGesture(): void {
    if (this.gesturing) {
      this.gesturing = false;
      app.controller?.commitParamGesture();
    }
  }

  connectedCallback(): void {
    const tryBind = () => {
      if (!app.store) return queueMicrotask(tryBind);
      app.store.subscribe(() => this.refresh());
      this.refresh();
    };
    tryBind();

    // 事件委托：区域定位 / 删除（shadow 内部）
    this.shadowRoot?.querySelector('[data-testid="zone-list"]')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-zone-action]');
      if (!btn) return;
      const id = btn.closest<HTMLElement>('[data-zone-id]')?.dataset.zoneId;
      if (!id) return;
      if (btn.dataset.zoneAction === 'focus') app.controller?.focusZone(id);
      if (btn.dataset.zoneAction === 'delete') app.controller?.deleteZone(id);
    });
  }

  private refresh(): void {
    const s = app.store?.state;
    if (!s || !this.shadowRoot) return;
    const root = this.shadowRoot;
    const p = s.params;

    root.querySelectorAll<HTMLButtonElement>('[data-density]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.density === p.density));
    });
    const densityHint = root.querySelector('[data-testid="density-hint"]');
    if (densityHint) densityHint.textContent = DENSITY_CONFIG[p.density].hint;

    const spacing = root.querySelector<HTMLInputElement>('#spacing');
    if (spacing && document.activeElement !== spacing) spacing.value = String(p.minSpacing);
    const spacingOut = root.querySelector('[data-testid="spacing-value"]');
    if (spacingOut) spacingOut.textContent = `${p.minSpacing} px`;
    spacing?.style.setProperty('--fill', `${((p.minSpacing - SPACING.min) / (SPACING.max - SPACING.min)) * 100}%`);

    const ratioPct = Math.round(p.treeRatio * 100);
    const ratio = root.querySelector<HTMLInputElement>('#ratio');
    if (ratio && document.activeElement !== ratio) ratio.value = String(ratioPct);
    const ratioOut = root.querySelector('[data-testid="ratio-value"]');
    if (ratioOut) ratioOut.textContent = `${ratioPct}% 树`;
    ratio?.style.setProperty('--fill', `${ratioPct}%`);
    const treeBar = root.querySelector<HTMLElement>('[data-ratio-tree]');
    const bushBar = root.querySelector<HTMLElement>('[data-ratio-bush]');
    if (treeBar) treeBar.style.width = `${ratioPct}%`;
    if (bushBar) bushBar.style.width = `${100 - ratioPct}%`;
    const tl = root.querySelector('[data-ratio-tree-label]');
    const bl = root.querySelector('[data-ratio-bush-label]');
    if (tl) tl.textContent = `${ratioPct}%`;
    if (bl) bl.textContent = `${100 - ratioPct}%`;

    this.refreshZones(s);
  }

  private refreshZones(s: ProjectState): void {
    const sig = JSON.stringify(s.zones.map((z) => [z.id, z.name, z.w, z.h]));
    const countEl = this.shadowRoot?.querySelector('[data-zone-count]');
    if (countEl) countEl.textContent = `${s.zones.length} 片`;

    const list = this.shadowRoot?.querySelector('[data-testid="zone-list"]');
    if (!list) return;

    if (sig !== this.lastZoneSig) {
      this.lastZoneSig = sig;
      if (s.zones.length === 0) {
        list.innerHTML = `<div class="empty-tip">还没有散布区域<br/>点击顶部「划定区域」在地形上拖一个框</div>`;
      } else {
        const colors = ['#6fe3b0', '#67c9ff', '#e2a455', '#c79bff'];
        list.innerHTML = s.zones
          .map((z, i) => `
          <div class="zone-item" data-zone-id="${z.id}" data-testid="zone-item">
            <span class="zone-dot" style="background:${colors[i % colors.length]}"></span>
            <span class="zone-name" title="${z.name}">${z.name}</span>
            <span class="zone-size" data-zone-size="${z.id}"></span>
            <span class="mini-actions">
              <button class="mini-btn" data-zone-action="focus" title="定位到此区域" data-testid="zone-focus">◎</button>
              <button class="mini-btn del" data-zone-action="delete" title="删除区域及其植被" data-testid="zone-delete">✕</button>
            </span>
          </div>`)
          .join('');
      }
    }

    // 计数每次刷新都更新（擦除 / 重撒后保持准确）
    const counts = new Map<string, number>();
    for (const it of s.instances) counts.set(it.zoneId, (counts.get(it.zoneId) ?? 0) + 1);
    for (const z of s.zones) {
      const el = this.shadowRoot?.querySelector(`[data-zone-size="${z.id}"]`);
      if (el) el.textContent = `${Math.round(z.w)}×${Math.round(z.h)} · ${counts.get(z.id) ?? 0}`;
    }
  }
}

customElements.define('scatter-panel', ScatterPanel);
