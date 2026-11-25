import { countInstances } from '../core/actions';
import { app } from '../core/context';
import type { LayerKind } from '../core/types';
import { getSharedSheet } from './shared-styles';

const TREE_SVG = `<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-.7 1.9-2 3-3.3 4.2C7.1 7.7 5.5 9.2 5.5 12a4.5 4.5 0 0 0 2.6 4.1V18a2 2 0 0 0 2 2h3.8a2 2 0 0 0 2-2v-1.9A4.5 4.5 0 0 0 18.5 12c0-2.8-1.6-4.3-3.2-5.8C14 5 12.7 3.9 12 2Z"/><rect x="10.8" y="17" width="2.4" height="4.5" rx="1"/></svg>`;
const BUSH_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="14" r="4.2"/><circle cx="15.5" cy="12.5" r="5"/><circle cx="12" cy="17" r="4.4"/><circle cx="17.5" cy="17" r="3"/></svg>`;

/** 图层列表：树木层 / 灌木层独立显隐与重撒，附统计 */
export class LayerList extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [getSharedSheet()];
    root.innerHTML = `
      <div class="panel-inner">
        <section>
          <h3 class="section-title">植被图层 <span class="sub">2 层</span></h3>
          <div style="display:flex;flex-direction:column;gap:11px" data-testid="layer-cards">
            ${this.layerCard('trees', '树木层', TREE_SVG, 'tree')}
            ${this.layerCard('bushes', '灌木层', BUSH_SVG, 'bush')}
          </div>
        </section>

        <section>
          <h3 class="section-title">实例统计</h3>
          <div class="stats-grid">
            <div class="stat-box"><div class="k">树木</div><div class="v tree" data-stat-trees data-testid="stat-trees">0</div></div>
            <div class="stat-box"><div class="k">灌木</div><div class="v bush" data-stat-bushes data-testid="stat-bushes">0</div></div>
            <div class="stat-box"><div class="k">高度带内</div><div class="v accent" data-stat-visible data-testid="stat-visible">0</div></div>
            <div class="stat-box"><div class="k">对象池待命</div><div class="v info" data-stat-pool data-testid="stat-pool">0</div></div>
          </div>
        </section>

        <section>
          <h3 class="section-title">工程</h3>
          <div class="stats-grid" style="grid-template-columns:1fr 1fr;">
            <div class="stat-box"><div class="k">散布区域</div><div class="v" style="color:#cdd9e6" data-stat-zones>0</div></div>
            <div class="stat-box"><div class="k">撤销步数</div><div class="v" style="color:#cdd9e6" data-stat-history>0</div></div>
          </div>
          <div class="history-mini" style="margin-top:10px">
            <span>上一步：<b data-last-action>—</b></span>
          </div>
          <button class="btn block danger-ghost" id="clear-zones" data-testid="clear-zones" style="margin-top:10px">
            清空全部区域与植被
          </button>
        </section>
      </div>
    `;

    root.querySelectorAll<HTMLInputElement>('[data-layer-toggle]').forEach((sw) => {
      sw.addEventListener('change', () =>
        app.controller?.toggleLayer(sw.dataset.layerToggle as LayerKind),
      );
    });
    root.querySelectorAll<HTMLButtonElement>('[data-layer-rescatter]').forEach((btn) => {
      btn.addEventListener('click', () =>
        app.controller?.rescatterLayer(btn.dataset.layerRescatter as LayerKind),
      );
    });
    root.getElementById('clear-zones')?.addEventListener('click', () => {
      // 内联确认态，避免 window.confirm 在无头环境被自动取消
      const btn = root.getElementById('clear-zones') as HTMLButtonElement;
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = '再次点击确认清空（可撤销）';
        window.setTimeout(() => {
          btn.dataset.confirm = '0';
          btn.textContent = '清空全部区域与植被';
        }, 3000);
        return;
      }
      app.controller?.store.run('清空全部区域与植被', (d) => {
        d.zones = [];
        d.instances = [];
        d.strokes = [];
      });
      btn.dataset.confirm = '0';
      btn.textContent = '清空全部区域与植被';
    });
  }

  private layerCard(kind: LayerKind, name: string, svg: string, tone: string): string {
    return `
      <div class="layer-card" data-layer-card="${kind}" data-testid="layer-${kind}">
        <div class="layer-head">
          <span class="layer-icon ${tone}">${svg}</span>
          <div class="layer-title">
            <strong>${name}</strong>
            <span data-layer-count="${kind}" data-testid="layer-count-${kind}">0 个实例</span>
          </div>
          <label class="switch" title="显示 / 隐藏${name}">
            <input type="checkbox" checked data-layer-toggle="${kind}" data-testid="layer-toggle-${kind}" />
            <span class="track"><span class="thumb"></span></span>
          </label>
        </div>
        <div class="layer-foot">
          <button class="btn sm" data-layer-rescatter="${kind}" data-testid="layer-rescatter-${kind}">
            ⟳ 重新散布${name}
          </button>
        </div>
      </div>`;
  }

  connectedCallback(): void {
    const tryBind = () => {
      if (!app.store) return queueMicrotask(tryBind);
      app.store.subscribe(() => this.refresh());
      this.refresh();
    };
    tryBind();
  }

  private refresh(): void {
    const s = app.store?.state;
    if (!s || !this.shadowRoot) return;
    const root = this.shadowRoot;
    const c = countInstances(s);

    const setText = (sel: string, text: string) => {
      const el = root.querySelector(sel);
      if (el) el.textContent = text;
    };
    setText('[data-stat-trees]', c.trees.toLocaleString());
    setText('[data-stat-bushes]', c.bushes.toLocaleString());
    setText('[data-stat-visible]', c.visible.toLocaleString());
    setText('[data-stat-zones]', String(s.zones.length));
    setText('[data-stat-history]', String(app.store?.historySize ?? 0));

    const pool = app.scene?.getPoolStats();
    const pooled = pool ? pool.treeFree + pool.bushFree : 0;
    setText('[data-stat-pool]', String(pooled));

    setText('[data-layer-count="trees"]', `${c.trees.toLocaleString()} 个实例`);
    setText('[data-layer-count="bushes"]', `${c.bushes.toLocaleString()} 个实例`);

    const last = app.store?.undoLabel;
    setText('[data-last-action]', last ?? '初始状态');

    (['trees', 'bushes'] as LayerKind[]).forEach((kind) => {
      const input = root.querySelector<HTMLInputElement>(`[data-layer-toggle="${kind}"]`);
      if (input && input.checked !== s.layers[kind].visible) input.checked = s.layers[kind].visible;
      root
        .querySelector(`[data-layer-card="${kind}"]`)
        ?.classList.toggle('is-hidden', !s.layers[kind].visible);
    });
  }
}

customElements.define('layer-list', LayerList);
