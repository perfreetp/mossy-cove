<script lang="ts">
  import { onMount } from 'svelte';
  import { Viewport } from '../lib/viewport';
  import { store } from '../lib/store.svelte';
  import { formatPct } from '../lib/geometry';

  let wrap = $state<HTMLDivElement | null>(null);
  let viewport: Viewport | null = null;

  onMount(() => {
    if (!wrap) return;
    viewport = new Viewport(wrap);

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        store.undo();
      } else if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        store.redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (store.selectedNodeId) {
          event.preventDefault();
          store.deleteNode(store.selectedNodeId);
        } else if (store.selectedChannelId) {
          event.preventDefault();
          store.disconnectChannel(store.selectedChannelId);
        } else if (store.selectedRiserId) {
          event.preventDefault();
          store.deleteRiser(store.selectedRiserId);
        }
      } else if (event.key === 'Escape') {
        store.clearSelection();
        store.setMode('select');
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      viewport?.dispose();
      viewport = null;
    };
  });

  // 任何设计数据变化都触发一次轻量同步（reconcile 内部按需重建）
  $effect(() => {
    // 依赖收集：节点/通道/冒口/铸件/选择/流量
    void store.nodes.length;
    void store.channels.length;
    void store.risers.length;
    void store.casting;
    void store.selectedNodeId;
    void store.selectedChannelId;
    void store.selectedRiserId;
    void store.connectSourceId;
    void store.flow;
    viewport?.sync();
  });
</script>

<div class="canvas-wrap" bind:this={wrap}></div>

<div class="viewport-overlay overlay-topleft">
  <div class="overlay-badges">
    <span class="badge">节点 <strong>{store.nodes.length}</strong></span>
    <span class="badge">通道 <strong>{store.channels.length}</strong></span>
    <span class="badge">失衡 <strong style={store.unbalancedNodeIds.length ? 'color:var(--warn)' : ''}>{store.unbalancedNodeIds.length}</strong></span>
    <span class="badge">未接入 <strong style={store.flow.detachedNodeIds.length ? 'color:var(--warn)' : ''}>{store.flow.detachedNodeIds.length}</strong></span>
  </div>
  {#if store.mode === 'connect'}
    <span class="badge" style="border-color:var(--ok); color:var(--ok)">
      连线模式：{store.connectSourceId ? '请点击目标节点' : '请点击起点节点'}
    </span>
  {/if}
  {#if store.mode === 'add-node'}
    <span class="badge" style="border-color:var(--accent)">放置节点：点击空白处或铸件表面</span>
  {/if}
  {#if store.mode === 'add-riser'}
    <span class="badge" style="border-color:var(--riser); color:#ce93d8">放置冒口：点击铸件顶面</span>
  {/if}
</div>

{#if store.flow.rootIds.length > 0}
  <div class="viewport-overlay" style="right:12px; top:12px">
    <span class="badge">总入流分配 {formatPct(1, 0)}</span>
  </div>
{/if}

{#if store.toast}
  <div class="toast">{store.toast}</div>
{/if}
