<script lang="ts">
  import { store } from '../store.svelte';

  function select(id: string) {
    store.activePathId = id;
  }

  function add() {
    store.addPath();
  }

  function remove(id: string, e: Event) {
    e.stopPropagation();
    if (!confirm('删除该路径及其全部关键点？')) return;
    store.removePath(id);
  }
</script>

<div class="path-selector section">
  <div class="ps-head">
    <span class="label">路径</span>
    <div class="spacer"></div>
    <button class="small" onclick={add}>＋ 新建路径</button>
  </div>
  <div class="chips">
    {#each store.paths as p (p.id)}
      <button class={store.activePathId === p.id ? 'chip active' : 'chip'} onclick={() => select(p.id)}>
        {p.name}（{p.points.length}）
        <span
          class="chip-del"
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && remove(p.id, e)}
          onclick={(e) => remove(p.id, e)}
          title="删除路径"
        >
          ✕
        </span>
      </button>
    {/each}
    {#if store.paths.length === 0}
      <span class="muted">暂无路径，点击「新建路径」</span>
    {/if}
  </div>
</div>

<style>
.ps-head {
  display: flex;
  align-items: center;
}
.spacer {
  flex: 1;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.chip {
  position: relative;
  padding-right: 26px;
}
.chip-del {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-500);
  padding: 0 3px;
}
.chip-del:hover {
  color: var(--danger);
}
.small {
  padding: 3px 8px;
  font-size: 11px;
}
</style>
