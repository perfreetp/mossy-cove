<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { RISER_LIMIT, type CastingShape } from '../lib/types';
  import { formatMm } from '../lib/geometry';

  const shapes: Array<{ id: CastingShape; label: string }> = [
    { id: 'box', label: '箱体' },
    { id: 'stepped', label: '台阶件' },
    { id: 'cylinder', label: '筒体' }
  ];

  function hotspotName(id: string | null): string {
    return store.hotspots.find((h) => h.id === id)?.label ?? '—';
  }

  function updateCasting(field: keyof typeof store.casting, value: number | string) {
    store.updateCasting({ [field]: typeof value === 'string' ? Number(value) : value });
  }
</script>

<h2>冒口布置</h2>

<div class="hint">
  进入放置模式后在铸件顶面点击放置冒口（上限 {RISER_LIMIT} 个），系统自动测量冒口到最近热节的连接距离。
</div>

<div class="card">
  <div class="row spread" style="margin-bottom:8px">
    <h3 style="margin:0">冒口数量 {store.risers.length}/{RISER_LIMIT}</h3>
    <button
      class="primary"
      disabled={store.riserLimitReached}
      class:active={store.mode === 'add-riser'}
      onclick={() => store.setMode(store.mode === 'add-riser' ? 'select' : 'add-riser')}
    >
      {store.mode === 'add-riser' ? '取消放置' : '+ 放置冒口'}
    </button>
  </div>
  <div class="progress" class:full={store.riserLimitReached}>
    <div style="width:{(store.risers.length / RISER_LIMIT) * 100}%"></div>
  </div>
  {#if store.riserLimitReached}
    <p class="faint" style="color:var(--warn); margin:8px 0 0; font-size:11px">
      已达冒口数量上限，请先删除现有冒口。
    </p>
  {/if}
</div>

<div class="card">
  <h3 style="margin-top:0">冒口清单</h3>
  {#if store.risers.length === 0}
    <div class="empty">尚未放置冒口</div>
  {/if}
  {#each store.risers as riser, i (riser.id)}
    <div
      class="card"
      style="margin-bottom:8px; padding:8px"
      class:selected={store.selectedRiserId === riser.id}
      role="button"
      tabindex="0"
      onclick={() => store.selectRiser(riser.id)}
      onkeydown={(e) => e.key === 'Enter' && store.selectRiser(riser.id)}
    >
      <div class="row spread" style="margin-bottom:6px">
        <strong>冒口 {i + 1}</strong>
        <button
          class="icon-btn danger"
          onclick={(e) => {
            e.stopPropagation();
            store.deleteRiser(riser.id);
          }}
        >
          ✕
        </button>
      </div>
      <dl class="kv" style="margin-bottom:8px">
        <dt>规格</dt>
        <dd>Ø{riser.diameter.toFixed(0)} × H{riser.height.toFixed(0)}</dd>
        <dt>最近热节</dt>
        <dd>{hotspotName(riser.linkedHotSpotId)}</dd>
        <dt>连接距离</dt>
        <dd style:color={riser.distance !== null && riser.distance > 120 ? 'var(--warn)' : 'var(--text)'}>
          {formatMm(riser.distance)}
        </dd>
      </dl>
      <label class="field">
        <span>直径 Ø {riser.diameter.toFixed(1)} mm</span>
        <input
          type="range"
          min="20"
          max="200"
          step="1"
          value={riser.diameter}
          onpointerdown={() => store.snapshot('调整冒口直径')}
          oninput={(e) => store.setRiserDiameter(riser.id, e.currentTarget.valueAsNumber, true)}
          onclick={(e) => e.stopPropagation()}
        />
      </label>
      <label class="field" style="margin-bottom:0">
        <span>高度 H {riser.height.toFixed(1)} mm</span>
        <input
          type="range"
          min="20"
          max="300"
          step="1"
          value={riser.height}
          onpointerdown={() => store.snapshot('调整冒口高度')}
          oninput={(e) => store.setRiserHeight(riser.id, e.currentTarget.valueAsNumber, true)}
        />
      </label>
    </div>
  {/each}
</div>

<div class="card">
  <h3 style="margin-top:0">热节（{store.hotspots.length}）</h3>
  {#each store.hotspots as hs (hs.id)}
    <div class="list-item">
      <span class="dot" style="width:9px;height:9px;border-radius:50%;background:var(--warn);flex:none"></span>
      <span class="name">{hs.label} · R{hs.radius.toFixed(0)}mm</span>
      <span class="faint" style="font-size:11px">
        ({hs.position.x.toFixed(0)}, {hs.position.y.toFixed(0)}, {hs.position.z.toFixed(0)})
      </span>
    </div>
  {/each}
</div>

<div class="card">
  <h3 style="margin-top:0">铸件参数</h3>
  <label class="field">
    <span>形状</span>
    <select
      value={store.casting.shape}
      onchange={(e) => updateCasting('shape', e.currentTarget.value)}
    >
      {#each shapes as s (s.id)}
        <option value={s.id}>{s.label}</option>
      {/each}
    </select>
  </label>
  <div class="row">
    <label class="field grow">
      <span>长 mm</span>
      <input
        type="number"
        min="100"
        max="1200"
        value={store.casting.length}
        onchange={(e) => updateCasting('length', e.currentTarget.valueAsNumber)}
      />
    </label>
    <label class="field grow">
      <span>宽 mm</span>
      <input
        type="number"
        min="100"
        max="1200"
        value={store.casting.width}
        onchange={(e) => updateCasting('width', e.currentTarget.valueAsNumber)}
      />
    </label>
  </div>
  <div class="row">
    <label class="field grow">
      <span>高 mm</span>
      <input
        type="number"
        min="80"
        max="800"
        value={store.casting.height}
        onchange={(e) => updateCasting('height', e.currentTarget.valueAsNumber)}
      />
    </label>
    <label class="field grow">
      <span>壁厚 mm</span>
      <input
        type="number"
        min="5"
        max="120"
        value={store.casting.wallThickness}
        onchange={(e) => updateCasting('wallThickness', e.currentTarget.valueAsNumber)}
      />
    </label>
  </div>
  <button style="width:100%" onclick={() => store.resetSample()}>恢复示例方案</button>
</div>
