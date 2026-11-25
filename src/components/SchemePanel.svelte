<script lang="ts">
  import { onMount } from 'svelte';
  import { appState, saveScheme, applyScheme, deleteScheme, loadSchemes } from '../lib/app-state.svelte';
  import type { ViewScheme } from '../lib/types';

  let schemeName = $state('');

  // 仅在组件挂载时读取一次本地方案
  onMount(() => {
    loadSchemes();
  });

  function save() {
    const name = schemeName.trim() || `方案 ${appState.schemes.length + 1}`;
    saveScheme(name);
    schemeName = '';
  }

  function fmt(ts: number) {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  }

  function summary(s: ViewScheme) {
    const on = (['x', 'y', 'z'] as const).filter(a => s.planes[a].enabled).join('/').toUpperCase();
    return `${on} · 切片×${s.slice.count} · ${s.slice.axis.toUpperCase()}向`;
  }
</script>

<div class="card">
  <h2>视图方案</h2>
  <p class="muted" style="font-size:11px; margin:0 0 8px">
    保存三个平面的位置/法向/颜色、切片参数与吸附设置,可随时恢复。
  </p>
  <div class="row">
    <input class="grow" type="text" placeholder="方案名称" bind:value={schemeName} onkeydown={(e) => e.key === 'Enter' && save()} />
    <button class="primary" onclick={save} disabled={!appState.modelInfo}>保存</button>
  </div>

  {#each appState.schemes as s (s.id)}
    <div class="scheme-item">
      <div class="meta">
        <div class="n">{s.name}</div>
        <div class="t">{fmt(s.createdAt)}</div>
        <div class="t mono">{summary(s)}</div>
      </div>
      <button onclick={() => applyScheme(s)}>恢复</button>
      <button class="danger" onclick={() => deleteScheme(s.id)}>删除</button>
    </div>
  {/each}
  {#if !appState.schemes.length}
    <div class="muted" style="font-size:11px">暂无保存的方案</div>
  {/if}
</div>
