<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { editor, editorView } from './editor';
  import TopBar from './components/TopBar.svelte';
  import TerrainPanel from './components/TerrainPanel.svelte';
  import BrushPanel from './components/BrushPanel.svelte';
  import CloudPanel from './components/CloudPanel.svelte';
  import CloudList from './components/CloudList.svelte';
  import LightingPanel from './components/LightingPanel.svelte';

  let canvas: HTMLCanvasElement;
  let toastMsg = '';
  let toastError = false;
  let toastTimer: ReturnType<typeof setTimeout>;

  function modeLabel(mode: string): string {
    return mode === 'brush' ? '笔刷' : mode === 'cloud' ? '云团拖拽' : '视角浏览';
  }

  export function showToast(message: string, isError = false): void {
    toastMsg = message;
    toastError = isError;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMsg = ''), 2400);
  }

  onMount(() => {
    editor.rememberCanvas(canvas);
    editor.attach(canvas);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        editor.redo();
      } else if (e.key === 'b' || e.key === 'B') {
        editor.setMode('brush');
      } else if (e.key === 'v' || e.key === 'V') {
        editor.setMode('cloud');
      } else if (e.key === 'Escape') {
        editor.setMode('camera');
        editor.selectCloud(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && $editorView.selectedId) {
        editor.deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      editor.detach();
    };
  });

  onDestroy(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });
</script>

<div class="stage">
  <canvas bind:this={canvas} class="render-canvas"></canvas>

  <TopBar onToast={showToast} />

  <aside class="left-dock panel">
    <div class="scroll-area dock-scroll">
      <TerrainPanel />
      <BrushPanel />
      <CloudPanel />
      <LightingPanel />
    </div>
  </aside>

  <CloudList />

  <footer class="status-bar">
    <span>地形网格 192×192（约 3.7 万顶点）</span>
    <span>云团 {$editorView.cloudCount} 个</span>
    <span>模式：{modeLabel($editorView.mode)}</span>
    <span class="spacer"></span>
    <span class="keys">B 笔刷 · V 云团 · Esc 视角 · Ctrl+Z 撤销 · Delete 删除选中</span>
  </footer>

  {#if toastMsg}
    <div class="toast" class:error={toastError}>{toastMsg}</div>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .render-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    outline: none;
    touch-action: none;
  }

  .left-dock {
    position: absolute;
    top: 64px;
    left: 16px;
    bottom: 44px;
    width: 288px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dock-scroll {
    flex: 1;
  }

  .status-bar {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 10px;
    height: 26px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px;
    font-size: 11px;
    color: var(--text-faint);
    background: rgba(14, 20, 32, 0.72);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    backdrop-filter: blur(10px);
    pointer-events: none;
  }

  .status-bar .spacer {
    flex: 1;
  }

  .status-bar .keys {
    color: var(--text-faint);
  }
</style>
