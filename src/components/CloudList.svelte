<script lang="ts">
  import { editor, editorView } from '../editor';

  $: state = $editorView.cloudState;
  $: selectedId = $editorView.selectedId;
</script>

<aside class="cloud-dock panel">
  <div class="dock-head">
    <h3 class="section-title" style="margin:0">云团列表（{state.blobs.length}）</h3>
  </div>
  <div class="scroll-area list">
    {#each state.blobs as blob, i (blob.id)}
      <div
        class="cloud-item"
        class:selected={blob.id === selectedId}
        role="button"
        tabindex="0"
        on:click={() => editor.selectCloud(blob.id)}
        on:keydown={(e) => e.key === 'Enter' && editor.selectCloud(blob.id)}
      >
        <span class="name">☁ 云团 {i + 1}</span>
        <span class="meta">
          {blob.density}/{blob.thickness}/{blob.height}
        </span>
        <button
          class="icon-btn active"
          class:is-off={!blob.visible}
          title={blob.visible ? '隐藏' : '显示'}
          on:click|stopPropagation={() => editor.toggleVisible(blob.id)}
        >
          {blob.visible ? '👁' : '🚫'}
        </button>
        <button
          class="icon-btn"
          class:active={blob.locked}
          title={blob.locked ? '解锁' : '锁定'}
          on:click|stopPropagation={() => editor.toggleLock(blob.id)}
        >
          {blob.locked ? '🔒' : '🔓'}
        </button>
      </div>
    {/each}
  </div>
</aside>

<style>
  .cloud-dock {
    position: absolute;
    top: 64px;
    right: 16px;
    bottom: 44px;
    width: 252px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dock-head {
    padding: 12px 14px 8px;
    border-bottom: 1px solid rgba(120, 160, 220, 0.1);
  }

  .list {
    flex: 1;
    padding: 8px;
  }

  .icon-btn.is-off {
    color: var(--text-faint);
  }
</style>
