<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { CHANNEL_META, DIAMETER_MAX, DIAMETER_MIN, LEVEL_META, NODE_META } from '../lib/meta';
  import { circleArea, formatMm, formatPct } from '../lib/geometry';
  import type { Channel } from '../lib/types';
</script>

<h2>检查器</h2>

{#if store.selectedNode}
  {@const node = store.selectedNode}
  {@const result = store.flow.nodes[node.id]}
  <div class="card">
    <div class="row spread">
      <h3 style="margin:0">{NODE_META[node.kind].label}</h3>
      <button class="icon-btn danger" onclick={() => store.deleteNode(node.id)}>删除</button>
    </div>
    <p class="faint" style="font-size:11px; margin:6px 0">{node.id}</p>
    <dl class="kv">
      <dt>坐标 X</dt><dd>{node.position.x.toFixed(1)}</dd>
      <dt>坐标 Y</dt><dd>{node.position.y.toFixed(1)}</dd>
      <dt>坐标 Z</dt><dd>{node.position.z.toFixed(1)}</dd>
      <dt>流入比例</dt>
      <dd style:color={store.flow.detachedNodeIds.includes(node.id) ? 'var(--warn)' : 'var(--ok)'}>
        {formatPct(result?.inflow ?? 0)}
      </dd>
      <dt>下游总截面</dt><dd>{(result?.downstreamArea ?? 0).toFixed(0)} mm²</dd>
      <dt>均衡状态</dt>
      <dd>
        {#if result && Object.keys(result.splitRatios).length >= 2}
          <span class="tag" class:warn={!result.balanced} class:ok={result.balanced}>
            {result.balanced ? '均衡' : `失衡 ${(result.imbalance * 100).toFixed(0)}%`}
          </span>
        {:else}
          <span class="tag">无分叉</span>
        {/if}
      </dd>
    </dl>

    {#if result && Object.keys(result.splitRatios).length >= 2}
      <div class="divider"></div>
      <h3 style="margin-top:0">分出比例</h3>
      {#each Object.entries(result.splitRatios) as [channelId, ratio] (channelId)}
        {@const ch = store.channelById(channelId)}
        <div style="margin-bottom:6px">
          <div class="row spread" style="font-size:11px; margin-bottom:3px">
            <span class="muted">{ch ? CHANNEL_META[ch.type].label : channelId}</span>
            <span>{formatPct(ratio)}</span>
          </div>
          <div class="progress"><div style="width:{ratio * 100}%"></div></div>
        </div>
      {/each}
    {/if}
  </div>

{:else if store.selectedChannel}
  {@const channel: Channel = store.selectedChannel}
  {@const from = store.nodeById(channel.from)}
  {@const to = store.nodeById(channel.to)}
  {@const len = store.channelLength(channel.id) ?? 0}
  {@const flow = store.flow.channels[channel.id]}
  <div class="card">
    <h3 style="margin-top:0">
      {CHANNEL_META[channel.type].label}
      <span class="tag l{channel.level}" style="margin-left:6px">L{channel.level}</span>
    </h3>
    <dl class="kv">
      <dt>起点</dt><dd>{from ? NODE_META[from.kind].label : '—'}</dd>
      <dt>终点</dt><dd>{to ? NODE_META[to.kind].label : '—'}</dd>
      <dt>长度</dt><dd>{formatMm(len)}</dd>
      <dt>截面积</dt><dd>{circleArea(channel.diameter).toFixed(1)} mm²</dd>
      <dt>流量份额</dt><dd style="color:var(--accent)">{formatPct(flow?.share ?? 0)}</dd>
    </dl>

    <div class="divider"></div>
    <label class="field">
      <span>管径 Ø {channel.diameter.toFixed(1)} mm（{DIAMETER_MIN}–{DIAMETER_MAX}）</span>
      <input
        type="range"
        min={DIAMETER_MIN}
        max={DIAMETER_MAX}
        step="0.5"
        value={channel.diameter}
        onpointerdown={() => store.snapshot('调整管径')}
        oninput={(e) => store.setChannelDiameter(channel.id, e.currentTarget.valueAsNumber, true)}
      />
    </label>

    <label class="field">
      <span>主次层级</span>
      <select
        value={String(channel.level)}
        onchange={(e) => store.setChannelLevel(channel.id, Number(e.currentTarget.value) as 1 | 2 | 3)}
      >
        <option value="1">{LEVEL_META[1].label}</option>
        <option value="2">{LEVEL_META[2].label}</option>
        <option value="3">{LEVEL_META[3].label}</option>
      </select>
    </label>

    <div class="row">
      <button class="grow danger" onclick={() => store.disconnectChannel(channel.id)}>断开连接</button>
    </div>
    <p class="faint" style="font-size:11px; margin-bottom:0; margin-top:8px">
      也可在视口中选中管段，拖动中点白色手柄实时改径；拖动端点节点改变长度。
    </p>
  </div>

{:else if store.selectedRiser}
  {@const riser = store.selectedRiser}
  <div class="card">
    <h3 style="margin-top:0">冒口参数</h3>
    <dl class="kv">
      <dt>直径</dt><dd>{riser.diameter.toFixed(1)} mm</dd>
      <dt>高度</dt><dd>{riser.height.toFixed(1)} mm</dd>
      <dt>最近热节</dt>
      <dd>{store.hotspots.find((h) => h.id === riser.linkedHotSpotId)?.label ?? '—'}</dd>
      <dt>连接距离</dt>
      <dd style:color={riser.distance !== null && riser.distance > 120 ? 'var(--warn)' : 'var(--text)'}>
        {formatMm(riser.distance)}
      </dd>
    </dl>
    <label class="field">
      <span>直径 Ø {riser.diameter.toFixed(1)}</span>
      <input
        type="range"
        min="20"
        max="200"
        value={riser.diameter}
        onpointerdown={() => store.snapshot('调整冒口直径')}
        oninput={(e) => store.setRiserDiameter(riser.id, e.currentTarget.valueAsNumber, true)}
      />
    </label>
    <label class="field">
      <span>高度 H {riser.height.toFixed(1)}</span>
      <input
        type="range"
        min="20"
        max="300"
        value={riser.height}
        onpointerdown={() => store.snapshot('调整冒口高度')}
        oninput={(e) => store.setRiserHeight(riser.id, e.currentTarget.valueAsNumber, true)}
      />
    </label>
    <button class="danger" style="width:100%" onclick={() => store.deleteRiser(riser.id)}>删除冒口</button>
  </div>

{:else}
  <div class="card">
    <h3 style="margin-top:0">未选中对象</h3>
    <p class="muted" style="font-size:12px; line-height:1.7">
      在视口中点击节点、浇道或冒口查看参数；在「节点编辑」模块可断开重连。
    </p>
  </div>
{/if}

<div class="card">
  <h3 style="margin-top:0">图例</h3>
  <div class="legend">
    <div class="item"><span class="dot" style="background:#ff8f00"></span>浇口杯 / L1 直浇道</div>
    <div class="item"><span class="dot" style="background:#ffc107"></span>L2 横浇道</div>
    <div class="item"><span class="dot" style="background:#26c6da"></span>L3 内浇口</div>
    <div class="item"><span class="dot" style="background:#ab47bc"></span>冒口</div>
    <div class="item"><span class="dot" style="background:#ef5350"></span>热节 / 失衡节点</div>
    <div class="item"><span class="dot" style="background:#69f0ae"></span>吸附指示环</div>
  </div>
</div>

<div class="card">
  <h3 style="margin-top:0">快捷键</h3>
  <dl class="kv">
    <dt>Ctrl+Z</dt><dd>撤销</dd>
    <dt>Ctrl+Y</dt><dd>重做</dd>
    <dt>Delete</dt><dd>删除选中</dd>
    <dt>Esc</dt><dd>取消选择/模式</dd>
  </dl>
</div>
