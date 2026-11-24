<script module lang="ts">
  // 用通道 id 尾号作为短标签
  function channelLabel(channelId: string): string {
    return `管段 ${channelId.slice(-4)}`;
  }
</script>

<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { exportCSV, exportJSON } from '../lib/exporter';
  import { formatPct } from '../lib/geometry';
  import { LEVEL_META, NODE_META } from '../lib/meta';

  let importMessage = $state<{ ok: boolean; text: string } | null>(null);

  function doExportJSON() {
    exportJSON(store.buildExportFile());
    store.showToast('JSON 方案文件已导出');
  }

  function doExportCSV() {
    exportCSV(
      store.nodes,
      store.channels,
      store.risers,
      store.flow,
      hotspotName,
      store.unbalancedNodeIds
    );
    store.showToast('CSV 工程量表已导出');
  }

  function hotspotName(id: string | null): string {
    return store.hotspots.find((h) => h.id === id)?.label ?? '—';
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = store.loadFromJSON(data);
      importMessage = result.ok
        ? { ok: true, text: `已导入：${file.name}` }
        : { ok: false, text: result.error ?? '导入失败' };
      if (result.ok) store.showToast('方案导入成功');
    } catch (err) {
      importMessage = {
        ok: false,
        text: `文件解析失败：${err instanceof Error ? err.message : '未知错误'}`
      };
    } finally {
      input.value = '';
    }
  }
</script>

<h2>导出</h2>

<div class="hint">
  将浇道网络（节点、连通关系、管径、层级、流量分配）与冒口布置（位置、规格、热节连接距离）写成文件。
</div>

<div class="card">
  <h3 style="margin-top:0">方案文件（JSON）</h3>
  <p class="muted" style="font-size:12px; line-height:1.6; margin:0 0 10px">
    完整数据，含铸件参数、浇道网络、冒口、失衡与断流汇总，可重新导入继续编辑。
  </p>
  <button class="primary" style="width:100%; margin-bottom:8px" onclick={doExportJSON}>
    ⇩ 导出 JSON 方案
  </button>
  <label class="field" style="margin:0">
    <span>导入 JSON 方案</span>
    <input type="file" accept=".json,application/json" onchange={onImportFile} />
  </label>
  {#if importMessage}
    <p style="margin:8px 0 0; font-size:11px; color:{importMessage.ok ? 'var(--ok)' : 'var(--warn)'}">
      {importMessage.text}
    </p>
  {/if}
</div>

<div class="card">
  <h3 style="margin-top:0">工程量表（CSV）</h3>
  <p class="muted" style="font-size:12px; line-height:1.6; margin:0 0 10px">
    通道管径/长度/截面积/流量份额、节点流入比例、冒口与热节距离，Excel 可直接打开。
  </p>
  <button style="width:100%" onclick={doExportCSV}>⇩ 导出 CSV 工程量表</button>
</div>

<div class="card">
  <h3 style="margin-top:0">导出前校核</h3>
  <dl class="kv">
    <dt>节点数</dt>
    <dd>{store.nodes.length}</dd>
    <dt>浇道数</dt>
    <dd>{store.channels.length}</dd>
    <dt>冒口数</dt>
    <dd>{store.risers.length} / 8</dd>
    <dt>失衡节点</dt>
    <dd style:color={store.unbalancedNodeIds.length ? 'var(--warn)' : 'var(--ok)'}>
      {store.unbalancedNodeIds.length}
    </dd>
    <dt>未接入节点</dt>
    <dd style:color={store.flow.detachedNodeIds.length ? 'var(--warn)' : 'var(--ok)'}>
      {store.flow.detachedNodeIds.length}
    </dd>
  </dl>
</div>

<div class="card">
  <h3 style="margin-top:0">各节点流入/分出比例</h3>
  {#each store.nodes as node (node.id)}
    {@const r = store.flow.nodes[node.id]}
    <div style="margin-bottom:8px">
      <div class="row spread">
        <span>{NODE_META[node.kind].label}</span>
        <span class="tag" class:warn={!!r && !r.balanced && Object.keys(r.splitRatios).length >= 2}>
          流入 {formatPct(r?.inflow ?? 0)}
        </span>
      </div>
      {#if r && Object.keys(r.splitRatios).length >= 2}
        <div class="row wrap" style="margin-top:4px; gap:4px">
          {#each Object.entries(r.splitRatios) as [channelId, ratio] (channelId)}
            <span class="faint" style="font-size:11px">
              {channelLabel(channelId)} {formatPct(ratio)}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<div class="faint" style="font-size:11px; line-height:1.7">
  层级定义：{LEVEL_META[1].label}；{LEVEL_META[2].label}；{LEVEL_META[3].label}。<br />
  分叉处按各下游通道截面积 A=πd²/4 的比例分配流量。
</div>
