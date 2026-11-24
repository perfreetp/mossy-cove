<script>
  import { history, jumpToHistory, redo, undo } from '../lib/store.js';

  let listElement = $state(null);

  $effect(() => {
    const currentIndex = $history.index;
    if (!listElement) return;
    const current = listElement.querySelector(
      `.history-item:nth-child(${currentIndex + 1})`
    ) ?? listElement.querySelector('.history-item.current');
    current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

<section class="panel history-panel">
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-icon" style="color:#d97706;background:#fef3c7;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v5h5" />
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
          <path d="M12 7v5l4 2" />
        </svg>
      </span>
      <h2 class="panel-title">操作历史</h2>
    </div>
    <span class="panel-meta">{$history.index + 1}/{$history.entries.length}</span>
  </div>

  <div class="panel-body">
    <div class="history-toolbar">
      <button class="btn" disabled={$history.index <= 0} onclick={undo}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
        </svg>
        撤销
      </button>
      <button class="btn" disabled={$history.index >= $history.entries.length - 1} onclick={redo}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9a5 5 0 0 0 0 10h3" />
        </svg>
        重做
      </button>
    </div>

    <div class="history-list" bind:this={listElement}>
      {#each $history.entries as entry, index (entry.id)}
        <button
          class="history-item"
          class:current={index === $history.index}
          class:future={index > $history.index}
          onclick={() => jumpToHistory(index)}
          title={`回到第 ${index + 1} 步：${entry.label}`}
        >
          <span class="history-dot"></span>
          <span class="history-text">
            <span class="history-label">{entry.label}</span>
            {#if entry.detail}<span class="history-detail">{entry.detail}</span>{/if}
          </span>
          <span class="history-step">{String(index + 1).padStart(2, '0')}</span>
        </button>
      {/each}
    </div>
  </div>
</section>
