<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import Viewport3D from './components/Viewport3D.svelte';
  import DrawPanel from './components/DrawPanel.svelte';
  import NodePanel from './components/NodePanel.svelte';
  import RiserPanel from './components/RiserPanel.svelte';
  import ExportPanel from './components/ExportPanel.svelte';
  import Inspector from './components/Inspector.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import { store } from './lib/store.svelte';
  import type { ModuleId } from './lib/types';

  const modules: Array<{ id: ModuleId; label: string; icon: string }> = [
    { id: 'draw', label: '浇道绘制', icon: '✎' },
    { id: 'node', label: '节点编辑', icon: '⬡' },
    { id: 'riser', label: '冒口布置', icon: '◒' },
    { id: 'export', label: '导出', icon: '⇩' }
  ];
</script>

<div class="app-shell">
  <TopBar {modules} />
  <aside class="side-left">
    {#if store.module === 'draw'}
      <DrawPanel />
    {:else if store.module === 'node'}
      <NodePanel />
    {:else if store.module === 'riser'}
      <RiserPanel />
    {:else}
      <ExportPanel />
    {/if}
  </aside>

  <main class="viewport-host">
    <Viewport3D />
  </main>

  <aside class="side-right">
    <Inspector />
  </aside>

  <StatusBar />
</div>
