<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './app.css';
import Toolbar from './components/Toolbar.svelte';
import Viewport3D from './components/Viewport3D.svelte';
import PlanMapPanel from './components/PlanMapPanel.svelte';
import SidePanel from './components/SidePanel.svelte';
import StatusBar from './components/StatusBar.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import { bindKeyboardShortcuts } from './lib/keyboard';

  let panelCollapsed = $state(false);
  let unbind: (() => void) | null = null;
  onMount(() => {
    unbind = bindKeyboardShortcuts();
  });
  onDestroy(() => unbind?.());
</script>

<div class="app-shell">
  <Toolbar />
  <div class="workspace">
    <Viewport3D />
    <PlanMapPanel />
    {#if !panelCollapsed}
      <SidePanel onCollapse={() => (panelCollapsed = true)} />
    {/if}
    {#if panelCollapsed}
      <button class="expand-btn" onclick={() => (panelCollapsed = false)} title="展开侧栏">
        ◧
      </button>
    {/if}
  </div>
  <StatusBar />
  <ToastHost />
</div>
