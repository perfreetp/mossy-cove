<script>
  import { history, undo, redo } from '../lib/store.js';
  import { exportProjectFile, pickProjectFile } from '../lib/projectFile.js';
  import { showToast } from '../lib/feedback.js';

  let { onFrame = () => {} } = $props();

  async function handleImport() {
    try {
      const ok = await pickProjectFile();
      if (ok) showToast('沙盘文件已导入');
    } catch (error) {
      console.error(error);
      showToast(`导入失败：${error.message || '文件格式不正确'}`, 'error');
    }
  }
</script>

<header class="topbar">
  <div class="brand">
    <div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-6h6v6" />
        <path d="M9 10h.01M15 10h.01M9 13h.01M15 13h.01" />
      </svg>
    </div>
    <div>
      <div class="brand-title">微缩建筑楼层拆分工作台</div>
      <div class="brand-subtitle">Svelte · Three.js · manifold-3d 实体剖切</div>
    </div>
  </div>

  <div class="topbar-group topbar-divider"></div>

  <div class="topbar-group">
    <button class="btn btn-dark btn-icon" title="撤销 (Ctrl+Z)" disabled={$history.index <= 0} onclick={undo}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
      </svg>
    </button>
    <button class="btn btn-dark btn-icon" title="重做 (Ctrl+Shift+Z)" disabled={$history.index >= $history.entries.length - 1} onclick={redo}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9a5 5 0 0 0 0 10h3" />
      </svg>
    </button>
    <button class="btn btn-dark btn-small" onclick={onFrame} title="重新居中取景">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9V5a2 2 0 0 1 2-2h4" />
        <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
        <path d="M3 15v4a2 2 0 0 0 2 2h4" />
        <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
      </svg>
      取景
    </button>
  </div>

  <div class="top-actions">
    <button class="btn btn-dark" onclick={handleImport}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
      导入
    </button>
    <button class="btn btn-primary" onclick={exportProjectFile}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M17 8l-5-5-5 5" />
        <path d="M12 3v12" />
      </svg>
      导出分享文件
    </button>
  </div>
</header>
