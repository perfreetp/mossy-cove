<script>
  import { commit, cutFloorIds, doc, FLOOR_COLORS, selectFloor, ui } from '../lib/store.js';

  function isCut(id) {
    return $cutFloorIds.has ? $cutFloorIds.has(id) : $cutFloorIds.includes(id);
  }

  function toggleVisible(event, floor) {
    event.stopPropagation();
    commit(
      floor.visible ? '隐藏楼层' : '显示楼层',
      floor.name,
      (draft) => {
        const target = draft.floors[floor.index];
        target.visible = !target.visible;
      }
    );
  }

  function toggleDetached(event, floor) {
    event.stopPropagation();
    commit(
      floor.detached ? '楼层归位' : '抽离楼层',
      floor.name,
      (draft) => {
        draft.floors[floor.index].detached = !draft.floors[floor.index].detached;
      }
    );
  }
</script>

<section class="panel" style="min-height:0;">
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-icon" style="color:#7c3aed;background:#ede9fe;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 2 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
      </span>
      <h2 class="panel-title">楼层列表</h2>
    </div>
    <span class="panel-meta">
      {$doc.floors.length} 层{#if $cutFloorIds.length} · <strong style="color:var(--warning)">{$cutFloorIds.length} 层被剖到</strong>{/if}
    </span>
  </div>

  <div class="panel-body">
    <div class="floor-list">
      {#each [...$doc.floors].reverse() as floor (floor.id)}
        {@const cut = isCut(floor.id)}
        {@const selected = $ui.selectedFloorId === floor.id}
        <div
          class="floor-row"
          class:selected
          class:cut
          style={`--floor-color:${FLOOR_COLORS[floor.index % FLOOR_COLORS.length]}`}
          role="button"
          tabindex="0"
          onclick={() => selectFloor(floor.id)}
          onkeydown={(event) => event.key === 'Enter' && selectFloor(floor.id)}
        >
          <span class="floor-color-bar"></span>
          <div class="floor-info">
            <div class="floor-name-line">
              <span>{floor.name}</span>
            </div>
            <div class="floor-badges">
              {#if cut}<span class="badge cut">剖切中</span>{/if}
              {#if floor.detached}<span class="badge detached">已抽离</span>{/if}
              {#if floor.visible === false}<span class="badge hidden">已隐藏</span>{/if}
            </div>
          </div>
          <div class="floor-actions">
            <button
              class="icon-button"
              class:active={floor.visible !== false}
              title={floor.visible === false ? '显示该层' : '隐藏该层'}
              onclick={(event) => toggleVisible(event, floor)}
            >
              {#if floor.visible === false}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              {/if}
            </button>
            <button
              class="icon-button warning"
              class:active={floor.detached}
              title={floor.detached ? '平移回原堆叠位置' : '单独抽离到旁边'}
              onclick={(event) => toggleDetached(event, floor)}
            >
              {#if floor.detached}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12h18" />
                  <path d="m9 6-6 6 6 6" />
                  <path d="m15 6 6 6-6 6" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                  <path d="M5 6v12" />
                </svg>
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>
