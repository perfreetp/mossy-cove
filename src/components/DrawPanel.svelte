<script lang="ts">
  import { store, type ToolMode } from '../lib/store.svelte';
  import { NODE_META } from '../lib/meta';
  import type { NodeKind } from '../lib/types';

  const nodeKinds: NodeKind[] = ['cup', 'sprue-base', 'junction', 'ingate', 'free'];

  const modes: Array<{ id: ToolMode; label: string; hint: string }> = [
    { id: 'select', label: '选择/拖拽', hint: '拖动节点改长度，选中通道拖白色手柄改管径' },
    { id: 'add-node', label: '放置节点', hint: '在三维空间点击放置节点' },
    { id: 'connect', label: '连线成管', hint: '依次点击两个节点生成浇道管体' }
  ];
</script>

<h2>浇道绘制</h2>

<div class="hint">
  先放置节点（浇口杯 → 底窝 → 横浇道节点 → 内浇口），再用「连线成管」连接节点。
  管径变化时全网络按截面积比例实时重算流量。
</div>

<div class="card">
  <h3 style="margin-top:0">交互模式</h3>
  <div class="mode-grid">
    {#each modes as m (m.id)}
      <button
        class={store.mode === m.id ? 'active' : ''}
        onclick={() => store.setMode(m.id)}
      >
        {m.label}
      </button>
    {/each}
  </div>
  <p class="faint" style="margin:8px 0 0; font-size:11px; line-height:1.5">
    {modes.find((m) => m.id === store.mode)?.hint}
  </p>
</div>

{#if store.mode === 'add-node'}
  <div class="card">
    <h3 style="margin-top:0">节点类型</h3>
    <div class="row wrap">
      {#each nodeKinds as kind (kind)}
        <button
          class={store.pendingNodeKind === kind ? 'active' : ''}
          onclick={() => (store.pendingNodeKind = kind)}
        >
          {NODE_META[kind].label}
        </button>
      {/each}
    </div>
    <p class="faint" style="margin-bottom:0; font-size:11px">
      {NODE_META[store.pendingNodeKind].hint}
    </p>
  </div>
{/if}

<div class="card">
  <h3 style="margin-top:0">绘制要点</h3>
  <ul class="muted" style="margin:0; padding-left:18px; line-height:1.9; font-size:12px">
    <li>直浇道（L1）：浇口杯 → 直浇道底窝</li>
    <li>横浇道（L2）：底窝 → 横浇道节点</li>
    <li>内浇口（L3）：横浇道节点 → 内浇口</li>
    <li>拖动节点即可调整相邻管段长度</li>
    <li>选中管段后拖动中点白球调整管径</li>
    <li>节点靠近其它端点时自动吸附对齐</li>
  </ul>
</div>

<div class="card">
  <button class="danger grow" style="width:100%" onclick={() => store.clearNetwork()}>
    清空浇道网络
  </button>
</div>
