<script>
  import { onMount } from 'svelte';
  import TopBar from './components/TopBar.svelte';
  import BuildingPanel from './components/BuildingPanel.svelte';
  import FloorList from './components/FloorList.svelte';
  import InspectorPanel from './components/InspectorPanel.svelte';
  import SceneViewport from './components/SceneViewport.svelte';
  import SectionPanel from './components/SectionPanel.svelte';
  import HistoryPanel from './components/HistoryPanel.svelte';
  import { redo, setTransformMode, ui, undo } from './lib/store.js';
  import { toastState } from './lib/feedback.js';

  let frameScene = () => {};

  onMount(() => {
    function onKeyDown(event) {
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (isEditable) return;

      if (event.key.toLowerCase() === 'w') setTransformMode('translate');
      if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
      if (event.key.toLowerCase() === 'r') setTransformMode('scale');
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
</script>

<div class="app-shell">
  <TopBar onFrame={() => frameScene()} />

  <main class="workspace">
    <div class="left-column">
      <BuildingPanel />
      <FloorList />
      <InspectorPanel />
    </div>

    <SceneViewport registerFrame={(fn) => (frameScene = fn)} />

    <div class="right-column">
      <SectionPanel />
      <HistoryPanel />
    </div>
  </main>

  {#if $toastState}
    <div class="toast" class:error={$toastState.type === 'error'} role="status">
      {$toastState.message}
    </div>
  {/if}
</div>
