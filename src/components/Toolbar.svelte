<script lang="ts">
  import { store } from '../store.svelte';
  import { toastBus } from '../lib/toast.svelte';
  import { filesFromList, importPointCloud } from '../lib/importer';
  import { listClouds, deleteCloud, putCloud, type CloudRecord } from '../lib/db';
  import { generateAndStoreCloud } from '../lib/synthetic-cloud';
  import {
    downloadBlob,
    exportProject,
    findLocalCloud,
    parseProjectFile
  } from '../lib/project-file';
  import { uid } from '../lib/util';

  let showCloudMenu = $state(false);
  let showExportMenu = $state(false);
  let localClouds = $state<CloudRecord[]>([]);
  let fileInput: HTMLInputElement;
  let projectInput: HTMLInputElement;
  let busy = $state(false);

  async function refreshClouds() {
    localClouds = await listClouds();
  }
  refreshClouds();

  async function generateSynthetic() {
    busy = true;
    try {
      const result = await generateAndStoreCloud(250000);
      await refreshClouds();
      const rec = localClouds.find((c) => c.key === result.key);
      if (rec) {
        store.cloudRecord = rec;
        toastBus.success(`已生成模拟现场（${result.points.toLocaleString()} 点）并载入`);
      }
      showCloudMenu = false;
    } catch (err) {
      toastBus.error(err instanceof Error ? err.message : '生成失败');
    } finally {
      busy = false;
    }
  }

  async function onPickCloudFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    busy = true;
    try {
      const files = filesFromList(input.files);
      const result = await importPointCloud(files);
      await refreshClouds();
      store.cloudRecord = result.record;
      store.cloudError = null;
      toastBus.success(`点云「${result.record.name}」已存入浏览器本地（${result.format} 格式，${result.record.files.length} 个文件）`);
      for (const w of result.warnings) toastBus.show(w, 'info');
      showCloudMenu = false;
    } catch (err) {
      toastBus.error(err instanceof Error ? err.message : '点云导入失败');
    } finally {
      input.value = '';
      busy = false;
    }
  }

  async function loadFromLocal(record: CloudRecord) {
    store.cloudRecord = record;
    showCloudMenu = false;
    toastBus.info(`已切换到本地点云「${record.name}」`);
  }

  async function removeLocal(record: CloudRecord, e: Event) {
    e.stopPropagation();
    if (!confirm(`确认删除本地数据仓中的「${record.name}」？该操作不可恢复。`)) return;
    await deleteCloud(record.key);
    if (store.cloudRecord?.key === record.key) store.cloudRecord = null;
    await refreshClouds();
    toastBus.success('已删除');
  }

  async function onPickProject(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    busy = true;
    try {
      const parsed = await parseProjectFile(input.files[0]);
      // 内嵌点云先入库
      const embeddedPaths = Object.keys(parsed.embeddedFiles);
      if (embeddedPaths.length > 0) {
        const key = parsed.project.cloudKey || uid('cloud');
        const record = await putCloud(key, parsed.project.cloudName ?? '导入的点云', parsed.embeddedFiles);
        store.cloudRecord = record;
        parsed.project.cloudKey = key;
        toastBus.success(`内嵌点云已存入本地（${embeddedPaths.length} 个文件）`);
      } else if (parsed.project.cloudKey) {
        const found = await findLocalCloud(parsed.project);
        if (!found.cloudKey) {
          toastBus.show('工程引用的点云不在本机，请先导入对应点云文件夹', 'error', 6000);
        } else {
          const clouds = await listClouds();
          const rec = clouds.find((c) => c.key === found.cloudKey);
          if (rec) store.cloudRecord = rec;
          if (!found.exact) toastBus.show('按同名匹配到本地点云，请确认数据一致');
        }
      }
      store.loadProject(parsed.project);
      await refreshClouds();
      toastBus.success('工程已载入：裁剪范围、证据标记与漫游路径已恢复');
    } catch (err) {
      toastBus.error(err instanceof Error ? err.message : '工程文件解析失败');
    } finally {
      input.value = '';
      busy = false;
    }
  }

  async function doExport(includePointCloud: boolean) {
    if (!store.cloudRecord && (store.markers.length || store.clipBox)) {
      // 无点云也允许导出纯工程
    }
    busy = true;
    try {
      const { blob, filename } = await exportProject(store.serialize(), { includePointCloud });
      downloadBlob(blob, filename);
      const sizeMb = (blob.size / 1024 / 1024).toFixed(1);
      toastBus.success(`已导出 ${filename}（${sizeMb} MB），可发送给他人导入`);
      showExportMenu = false;
    } catch (err) {
      toastBus.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      busy = false;
    }
  }

  function closeMenus(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('.menu-wrap')) {
      showCloudMenu = false;
      showExportMenu = false;
    }
  }
</script>

<svelte:window onclick={closeMenus} />

<header class="toolbar">
  <div class="brand">
    <span class="logo">🕵</span>
    <div>
      <div class="title">案发现场点云空间复原与漫游工具</div>
      <div class="subtitle">Potree · Three.js · Svelte · 数据不出本机</div>
    </div>
  </div>

  <div class="actions">
    <div class="menu-wrap">
      <button class="primary" onclick={() => { showCloudMenu = !showCloudMenu; showExportMenu = false; }}>
        点云数据 ▾
      </button>
      {#if showCloudMenu}
        <div class="menu">
          <button onclick={generateSynthetic} disabled={busy}>
            🧪 生成模拟案发现场（无需外部数据）
          </button>
          <button onclick={() => fileInput.click()} disabled={busy}>
            导入点云文件夹（metadata.json / cloud.js）
          </button>
          <button onclick={() => projectInput.click()} disabled={busy}>导入工程文件（.cspcv）</button>
          <div class="menu-sep"></div>
          <div class="menu-title">本地数据仓（IndexedDB）</div>
          {#if localClouds.length === 0}
            <div class="menu-empty">暂无本地数据</div>
          {/if}
          {#each localClouds as rec (rec.key)}
            <div
              class="menu-item"
              class:active={store.cloudRecord?.key === rec.key}
              role="button"
              tabindex="0"
              onclick={() => loadFromLocal(rec)}
              onkeydown={(e) => e.key === 'Enter' && loadFromLocal(rec)}
            >
              <div class="mi-text">
                <div>{rec.name}</div>
                <div class="muted">{(rec.totalBytes / 1024 / 1024).toFixed(1)} MB · {rec.files.length} 文件</div>
              </div>
              <button class="ghost danger small" onclick={(e) => removeLocal(rec, e)} title="删除">✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="menu-wrap">
      <button onclick={() => { showExportMenu = !showExportMenu; showCloudMenu = false; }}>
        导出分享 ▾
      </button>
      {#if showExportMenu}
        <div class="menu">
          <button onclick={() => doExport(false)}>导出工程（不含点云，体积小）</button>
          <button onclick={() => doExport(true)}>导出完整包（含点云数据）</button>
        </div>
      {/if}
    </div>

    <div class="divider"></div>

    <div class="undo-group" title="证据标记撤销/重做">
      <button onclick={() => store.undoMarker()} disabled={!store.markerCanUndo}>↶ 标记</button>
      <button onclick={() => store.redoMarker()} disabled={!store.markerCanRedo}>↷ 标记</button>
    </div>
    <div class="undo-group" title="路径关键点撤销/重做">
      <button onclick={() => store.undoPath()} disabled={!store.pathCanUndo}>↶ 路径</button>
      <button onclick={() => store.redoPath()} disabled={!store.pathCanRedo}>↷ 路径</button>
    </div>
    <button onclick={() => store.undoClip()} disabled={!store.clipCanUndo} title="裁剪撤销">↶ 裁剪</button>
    <button onclick={() => store.redoClip()} disabled={!store.clipCanRedo} title="裁剪重做">↷ 裁剪</button>
  </div>
</header>

<input
  bind:this={fileInput}
  type="file"
  webkitdirectory
  directory
  multiple
  hidden
  onchange={onPickCloudFiles}
/>
<input bind:this={projectInput} type="file" hidden onchange={onPickProject} accept=".cspcv,.json" />

<style>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 16px;
  background: linear-gradient(180deg, #14213a, #0f1a2e);
  border-bottom: 1px solid var(--line);
  z-index: 40;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-size: 26px;
}
.title {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
}
.subtitle {
  font-size: 11px;
  color: var(--text-500);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.divider {
  width: 1px;
  height: 24px;
  background: var(--line);
  margin: 0 4px;
}
.undo-group {
  display: flex;
  gap: 4px;
}
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 300px;
  background: #14213a;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
  z-index: 60;
}
.menu button {
  text-align: left;
  width: 100%;
}
.menu-sep {
  height: 1px;
  background: var(--line);
  margin: 6px 0;
}
.menu-title {
  color: var(--text-500);
  font-size: 11px;
  padding: 2px 6px;
}
.menu-empty {
  color: var(--text-500);
  padding: 8px;
  font-size: 12px;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.menu-item:hover {
  background: var(--bg-600);
}
.menu-item.active {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.12);
}
.mi-text {
  min-width: 0;
}
.mi-text > div:first-child {
  font-weight: 600;
}
.muted {
  color: var(--text-500);
  font-size: 11px;
}
.small {
  padding: 2px 8px;
}
</style>
