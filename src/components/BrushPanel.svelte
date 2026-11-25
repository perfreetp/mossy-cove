<script lang="ts">
  import { editor, editorView } from '../editor';

  $: brush = $editorView.brush;
  $: mode = $editorView.mode;

  function onRadiusInput(e: Event): void {
    editor.setBrushRadius(Number((e.target as HTMLInputElement).value));
  }

  function onStrengthInput(e: Event): void {
    editor.setBrushStrength(Number((e.target as HTMLInputElement).value));
  }
</script>

<section class="panel-section">
  <h3 class="section-title">地形笔刷</h3>

  <div class="segmented" style="margin-bottom: 12px">
    <button
      class:active={mode === 'brush' && brush.mode === 'raise'}
      on:click={() => { editor.setBrushMode('raise'); editor.setMode('brush'); }}
    >
      ⬆ 抬升
    </button>
    <button
      class:active={mode === 'brush' && brush.mode === 'lower'}
      on:click={() => { editor.setBrushMode('lower'); editor.setMode('brush'); }}
    >
      ⬇ 压低
    </button>
    <button class:active={mode === 'camera'} on:click={() => editor.setMode('camera')}>
      🎥 视角
    </button>
  </div>

  <div class="slider-row">
    <div class="slider-head">
      <label for="br-radius">笔刷半径</label>
      <output>{brush.radius.toFixed(0)} m</output>
    </div>
    <input
      id="br-radius"
      type="range"
      min="4"
      max="60"
      step="1"
      value={brush.radius}
      on:input={onRadiusInput}
    />
  </div>

  <div class="slider-row">
    <div class="slider-head">
      <label for="br-strength">笔刷强度</label>
      <output>{brush.strength.toFixed(1)}</output>
    </div>
    <input
      id="br-strength"
      type="range"
      min="1"
      max="20"
      step="0.5"
      value={brush.strength}
      on:input={onStrengthInput}
    />
  </div>

  <p class="hint">在地形上按住拖动即可修改；松手后自动重算法线、云团贴合与云影，整笔笔画可一次撤销。</p>
</section>
