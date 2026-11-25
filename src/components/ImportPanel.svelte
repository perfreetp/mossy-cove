<script lang="ts">
  import { appState, importModel } from '../lib/app-state.svelte';
  import { parseModel } from '../lib/mesh-loaders';
  import { buildDemoFossil } from '../lib/demo-model';

  let fileInput: HTMLInputElement;
  let dragOver = $state(false);

  async function handleFile(file: File) {
    const buf = await file.arrayBuffer();
    try {
      await importModel(async () => parseModel(file.name, buf), file.name);
    } catch {
      // 错误已写入 appState.loadError
    }
  }

  function onPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void handleFile(file);
  }

  function onDrop(e: DragEvent) {
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  }

  async function loadDemo() {
    try {
      const demo = await buildDemoFossil();
      await importModel(
        async () => ({ vertices: demo.vertices, indices: demo.indices }),
        demo.name
      );
    } catch {
      /* 错误已记录到 appState.loadError */
    }
  }
</script>

<div class="card">
  <h2>模型导入</h2>
  <div
    class="dropzone"
    class:over={dragOver}
    role="button"
    tabindex="0"
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    ondrop={(e) => { e.preventDefault(); onDrop(e); }}
    onclick={() => fileInput.click()}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); }}
  >
    <div>点击选择或拖入模型文件</div>
    <div class="muted" style="font-size:11px; margin-top:4px">STL / OBJ / PLY / GLB / GLTF</div>
  </div>
  <input
    bind:this={fileInput} type="file" accept=".stl,.obj,.ply,.glb,.gltf"
    style="display:none" onchange={onPick}
  />
  <div class="row" style="margin-top:10px">
    <button class="grow primary" onclick={loadDemo}>加载示例化石</button>
  </div>

  {#if appState.modelInfo}
    {@const b = appState.modelInfo.bounds}
    <div class="info mono" style="margin-top:10px">
      <div class="row" style="margin-bottom:4px"><span class="muted">文件</span><span class="grow" style="text-align:right; word-break:break-all">{appState.modelName}</span></div>
      <div class="row" style="margin-bottom:4px"><span class="muted">顶点</span><span class="grow" style="text-align:right">{appState.modelInfo.vertexCount.toLocaleString()}</span></div>
      <div class="row" style="margin-bottom:4px"><span class="muted">三角面</span><span class="grow" style="text-align:right">{appState.modelInfo.triangleCount.toLocaleString()}</span></div>
      <div class="row" style="margin-bottom:4px"><span class="muted">流形状态</span><span class="grow" style="text-align:right; color:var(--accent-2)">{appState.modelInfo.manifoldStatus}</span></div>
      <div class="muted" style="font-size:11px; margin-top:6px">
        尺寸 {b.size[0].toFixed(2)} × {b.size[1].toFixed(2)} × {b.size[2].toFixed(2)}
      </div>
    </div>
  {/if}
</div>

<style>
  .dropzone {
    border: 1.5px dashed var(--border);
    border-radius: 8px;
    padding: 18px 10px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .dropzone:hover, .dropzone.over { border-color: var(--accent); background: rgba(77,150,255,0.08); }
</style>
