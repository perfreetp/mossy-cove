<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { CHANNEL_META, LEVEL_META, NODE_META } from '../lib/meta';
  import { circleArea, formatPct } from '../lib/geometry';

  function flowColor(nodeId: string): string {
    const r = store.flow.nodes[nodeId];
    if (!r) return 'var(--text-faint)';
    if (!r.balanced && Object.keys(r.splitRatios).length >= 2) return 'var(--warn)';
    return 'var(--ok)';
  }

  function setEndpoint(channelId: string, endpoint: 'from' | 'to', value: string) {
    store.reconnectChannel(channelId, endpoint, value);
  }
</script>

<h2>节点编辑</h2>

<div class="hint">
  增删节点、断开或重连浇道。断开后下游管段流量立即归零，全网络重新分配。
</div>

<div class="card">
  <div class="row spread" style="margin-bottom:8px">
    <h3 style="margin:0">节点列表（{store.nodes.length}）</h3>
    <button class="icon-btn primary" onclick={() => store.setMode('add-node')}>+ 新增</button>
  </div>
  {#if store.nodes.length === 0}
    <div class="empty">暂无节点，切换到「浇道绘制」放置节点</div>
  {/if}
  {#each store.nodes as node (node.id)}
    {@const result = store.flow.nodes[node.id]}
    <div
      class="list-item"
      class:selected={store.selectedNodeId === node.id}
      role="button"
      tabindex="0"
      onclick={() => store.selectNode(node.id)}
      onkeydown={(e) => e.key === 'Enter' && store.selectNode(node.id)}
    >
      <span class="dot" style="width:9px;height:9px;border-radius:50%;background:{flowColor(node.id)};flex:none"></span>
      <div class="name">
        {NODE_META[node.kind].label}
        <span class="faint" style="font-size:11px">
          · 流入 {formatPct(result?.inflow ?? 0)}
        </span>
      </div>
      <button
        class="icon-btn danger"
        onclick={(e) => {
          e.stopPropagation();
          store.deleteNode(node.id);
        }}
        title="删除节点（关联浇道一并移除）"
      >
        ✕
      </button>
    </div>
  {/each}
</div>

<div class="card">
  <h3 style="margin-top:0">浇道连接（{store.channels.length}）</h3>
  {#if store.channels.length === 0}
    <div class="empty">暂无浇道，使用连线模式生成</div>
  {/if}
  {#each store.channels as channel (channel.id)}
    {@const len = store.channelLength(channel.id) ?? 0}
    {@const share = store.flow.channels[channel.id]?.share ?? 0}
    <div
      class="card"
      style="margin-bottom:8px; padding:8px"
      class:selected={store.selectedChannelId === channel.id}
      role="button"
      tabindex="0"
      onclick={() => store.selectChannel(channel.id)}
      onkeydown={(e) => e.key === 'Enter' && store.selectChannel(channel.id)}
    >
      <div class="row spread" style="margin-bottom:6px">
        <span class="tag l{channel.level}">L{channel.level} {CHANNEL_META[channel.type].label}</span>
        <span class="faint" style="font-size:11px">
          Ø{channel.diameter.toFixed(1)} · {len.toFixed(0)}mm · {formatPct(share)}
        </span>
      </div>
      <div class="row" style="gap:4px; margin-bottom:6px">
        <select
          value={channel.from}
          onclick={(e) => e.stopPropagation()}
          onchange={(e) => setEndpoint(channel.id, 'from', e.currentTarget.value)}
        >
          {#each store.nodes as n (n.id)}
            <option value={n.id}>{NODE_META[n.kind].label}</option>
          {/each}
        </select>
        <span class="faint">→</span>
        <select
          value={channel.to}
          onclick={(e) => e.stopPropagation()}
          onchange={(e) => setEndpoint(channel.id, 'to', e.currentTarget.value)}
        >
          {#each store.nodes as n (n.id)}
            <option value={n.id}>{NODE_META[n.kind].label}</option>
          {/each}
        </select>
      </div>
      <div class="row spread">
        <span class="faint" style="font-size:11px">
          截面 {circleArea(channel.diameter).toFixed(0)} mm²
        </span>
        <button
          class="icon-btn danger"
          onclick={(e) => {
            e.stopPropagation();
            store.disconnectChannel(channel.id);
          }}
        >
          断开
        </button>
      </div>
    </div>
  {/each}
</div>

<div class="card">
  <h3 style="margin-top:0">分叉均衡监测</h3>
  {#if store.unbalancedNodeIds.length === 0}
    <div class="row" style="color:var(--ok)">
      <span>✓</span><span>所有分叉节点均在阈值 {Math.round(store.imbalanceThreshold * 100)}% 内</span>
    </div>
  {:else}
    {#each store.unbalancedNodeIds as id (id)}
      {@const n = store.nodeById(id)}
      {@const r = store.flow.nodes[id]}
      {#if n && r}
        <div class="list-item" style="border-color:var(--warn)">
          <span class="name" style="color:var(--warn)">
            {NODE_META[n.kind].label} 失衡 {(r.imbalance * 100).toFixed(0)}%
          </span>
          <span class="tag warn">红色预警</span>
        </div>
      {/if}
    {/each}
  {/if}
</div>

{#if store.flow.detachedNodeIds.length > 0}
<div class="card" style="border-color:#8e2a2a">
  <h3 style="margin-top:0; color:var(--warn)">未接入节点（流入 0%）</h3>
  {#each store.flow.detachedNodeIds as id (id)}
    {@const n = store.nodeById(id)}
    {#if n}
      <div
        class="list-item"
        role="button"
        tabindex="0"
        onclick={() => store.selectNode(id)}
        onkeydown={(e) => e.key === 'Enter' && store.selectNode(id)}
      >
        <span class="name">{NODE_META[n.kind].label}</span>
        <span class="tag warn">断流</span>
      </div>
    {/if}
  {/each}
</div>
{/if}

<div class="faint" style="font-size:11px; line-height:1.6">
  层级速查：{LEVEL_META[1].label} / {LEVEL_META[2].label} / {LEVEL_META[3].label}
</div>
