<script lang="ts">
  import { store } from '../lib/store.svelte';

  const modeHints: Record<string, string> = {
    select: '选择/拖拽：左键拖动旋转视角，右键平移，滚轮缩放',
    'add-node': '放置节点：点击空白处或铸件表面',
    connect: '连线模式：依次点击两个节点',
    'add-riser': '冒口放置：点击铸件顶面（上限 8 个）'
  };
</script>

<footer class="statusbar">
  <span>{modeHints[store.mode] ?? ''}</span>
  <span class="grow"></span>
  <span>吸附：{store.snapEnabled ? '开' : '关'}</span>
  <span>
    失衡阈值 {Math.round(store.imbalanceThreshold * 100)}%
  </span>
  <span style:color={store.unbalancedNodeIds.length ? 'var(--warn)' : 'var(--ok)'}>
    失衡节点 {store.unbalancedNodeIds.length}
  </span>
  <span style:color={store.flow.detachedNodeIds.length ? 'var(--warn)' : 'var(--ok)'}>
    断流节点 {store.flow.detachedNodeIds.length}
  </span>
  {#if store.lastAction}
    <span class="faint">最近操作：{store.lastAction}</span>
  {/if}
</footer>
