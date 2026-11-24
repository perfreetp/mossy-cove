<script>
  import { BUILDING_PRESETS } from '../lib/geometry.js';
  import { commit, createFloors, doc, selectFloor } from '../lib/store.js';
  import { showToast } from '../lib/feedback.js';

  let countInput = $state($doc.floorCount);

  $effect(() => {
    countInput = $doc.floorCount;
  });

  function choosePreset(preset) {
    if (preset.id === $doc.buildingId) return;
    const count = Math.max(1, Math.min(30, Number(countInput) || preset.defaultFloors));
    commit('放入内置体块', `${preset.name} · ${count} 层`, (draft) => {
      draft.buildingId = preset.id;
      draft.floorCount = count;
      draft.floors = createFloors(count, []);
    });
    selectFloor('floor-1');
    showToast(`已放入「${preset.name}」`);
  }

  function applyFloorCount() {
    const next = Math.max(1, Math.min(30, Math.round(Number(countInput) || 1)));
    countInput = next;
    if (next === $doc.floorCount) return;

    commit('重新切分楼层', `${$doc.floorCount} 层 → ${next} 层；剖切位置保留`, (draft) => {
      draft.floorCount = next;
      draft.floors = createFloors(next, draft.floors);
    });

    selectFloor(`floor-${Math.min(next, 3)}`);
    showToast(`已按高度重新切分为 ${next} 个独立楼层`);
  }
</script>

<section class="panel">
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21h18" />
          <path d="M6 21V8l6-4 6 4v13" />
          <path d="M10 21v-5h4v5" />
        </svg>
      </span>
      <h2 class="panel-title">内置体块</h2>
    </div>
    <span class="panel-meta">选择即放入沙盘</span>
  </div>

  <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;">
    <div class="preset-grid">
      {#each BUILDING_PRESETS as preset}
        <button
          class="preset-card"
          class:active={preset.id === $doc.buildingId}
          onclick={() => choosePreset(preset)}
          title={preset.description}
        >
          <div class="preset-card-name">{preset.name}</div>
          <div class="preset-card-desc">{preset.description}</div>
        </button>
      {/each}
    </div>

    <div class="control-block">
      <div class="control-label-row">
        <label for="floor-count">楼层数量</label>
        <span class="control-value">当前 {$doc.floorCount} 层</span>
      </div>
      <div class="range-row">
        <input
          id="floor-count-range"
          type="range"
          min="1"
          max="30"
          step="1"
          bind:value={countInput}
          onchange={applyFloorCount}
        />
        <input
          id="floor-count"
          type="number"
          min="1"
          max="30"
          step="1"
          bind:value={countInput}
          onkeydown={(event) => event.key === 'Enter' && applyFloorCount()}
          onchange={applyFloorCount}
        />
      </div>
      <button class="btn btn-primary" onclick={applyFloorCount}>按总高度自动切分</button>
      <div class="info-note">
        每层使用 Manifold 与水平层高盒求交，生成独立封闭实体和楼板底面；修改层数不会移动当前剖切面。
      </div>
    </div>
  </div>
</section>
