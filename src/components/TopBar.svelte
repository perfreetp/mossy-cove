<script lang="ts">
  import { editor, editorView } from '../editor';

  export let onToast: (msg: string, error?: boolean) => void;

  let fileInput: HTMLInputElement;

  function triggerImport(input: HTMLInputElement | undefined): void {
    input?.click();
  }

  async function onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await editor.importFromFile(file);
      onToast('场景导入成功');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '导入失败', true);
    }
    input.value = '';
  }
</script>

<header class="topbar panel">
  <div class="brand">
    <span class="logo">☁</span>
    <div>
      <strong>Cloud Ridge Studio</strong>
      <small>程序化云层 · 山地背景生成</small>
    </div>
  </div>

  <div class="actions">
    <button class="btn" on:click={() => editor.undo()} disabled={!$editorView.canUndo} title="撤销 Ctrl+Z">
      ↶ 撤销
    </button>
    <button class="btn" on:click={() => editor.redo()} disabled={!$editorView.canRedo} title="重做 Ctrl+Y">
      ↷ 重做
    </button>
    <span class="divider"></span>
    <button class="btn" on:click={() => { editor.persist(); onToast('已保存到浏览器本地'); }}>
      💾 本地保存
    </button>
    <button class="btn primary" on:click={() => { editor.exportScene(); onToast('场景文件已导出'); }}>
      ⬇ 导出场景
    </button>
    <button class="btn" on:click={() => triggerImport(fileInput)}>
      ⬆ 导入
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      style="display:none"
      on:change={onFile}
    />
  </div>
</header>

<style>
  .topbar {
    position: absolute;
    top: 14px;
    left: 16px;
    right: 16px;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    z-index: 20;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo {
    font-size: 24px;
    filter: drop-shadow(0 0 10px rgba(93, 180, 255, 0.7));
  }

  .brand strong {
    display: block;
    font-size: 14px;
    letter-spacing: 0.04em;
  }

  .brand small {
    display: block;
    color: var(--text-faint);
    font-size: 10px;
    margin-top: 1px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .divider {
    width: 1px;
    height: 22px;
    background: var(--panel-border);
    margin: 0 4px;
  }
</style>
