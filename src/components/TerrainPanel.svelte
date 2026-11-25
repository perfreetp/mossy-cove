<script lang="ts">
  import { editor, editorView } from '../editor';
  import type { TerrainParams } from '../lib/noise';

  // 拖动开始前的快照：on:input 只做实时预览，on:change 松手时提交一条历史
  let editStart: TerrainParams = $editorView.terrainParams;
  $: relief = $editorView.terrainParams.relief;
  $: fragmentation = $editorView.terrainParams.fragmentation;
  $: baseHeight = $editorView.terrainParams.baseHeight;

  function startEdit(): void {
    editStart = { ...$editorView.terrainParams };
  }

  function finishEdit(): void {
    editor.commitTerrainChange(editStart);
  }
</script>

<section class="panel-section">
  <h3 class="section-title">地形高度场</h3>

  <div class="slider-row">
    <div class="slider-head">
      <label for="tr-relief">山脊起伏</label>
      <output>{Math.round(relief * 100)}%</output>
    </div>
    <input
      id="tr-relief"
      type="range"
      min="0"
      max="1"
      step="0.01"
      bind:value={relief}
      on:pointerdown={startEdit}
      on:input={() => editor.applyTerrainLive({ ...$editorView.terrainParams, relief })}
      on:change={finishEdit}
    />
  </div>

  <div class="slider-row">
    <div class="slider-head">
      <label for="tr-frag">破碎度</label>
      <output>{Math.round(fragmentation * 100)}%</output>
    </div>
    <input
      id="tr-frag"
      type="range"
      min="0"
      max="1"
      step="0.01"
      bind:value={fragmentation}
      on:pointerdown={startEdit}
      on:input={() => editor.applyTerrainLive({ ...$editorView.terrainParams, fragmentation })}
      on:change={finishEdit}
    />
  </div>

  <div class="slider-row">
    <div class="slider-head">
      <label for="tr-base">基准高度</label>
      <output>{Math.round(baseHeight * 100)}%</output>
    </div>
    <input
      id="tr-base"
      type="range"
      min="0"
      max="1"
      step="0.01"
      bind:value={baseHeight}
      on:pointerdown={startEdit}
      on:input={() => editor.applyTerrainLive({ ...$editorView.terrainParams, baseHeight })}
      on:change={finishEdit}
    />
  </div>

  <button class="btn tiny" style="width:100%" on:click={() => editor.regenerateSeed()}>
    🎲 重新生成地形（新种子）
  </button>
</section>
