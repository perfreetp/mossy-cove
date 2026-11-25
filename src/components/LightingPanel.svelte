<script lang="ts">
  import { editor, editorView } from '../editor';
  import { LIGHTING_PRESETS } from '../lib/lighting';

  const presets = editor.lightingPresets.map((id) => LIGHTING_PRESETS[id]);
  $: active = $editorView.lighting;

  const icons: Record<string, string> = {
    dawn: '🌅',
    noon: '☀',
    dusk: '🌇'
  };
</script>

<section class="panel-section">
  <h3 class="section-title">光照预设</h3>
  <div class="preset-grid">
    {#each presets as preset}
      <button
        class="preset-card"
        class:active={active === preset.id}
        on:click={() => editor.setLighting(preset.id)}
      >
        <span class="preset-icon">{icons[preset.id]}</span>
        <span>{preset.label}</span>
        <span
          class="swatch"
          style={`background: linear-gradient(135deg, rgb(${preset.skyZenith.map((c) => Math.round(c * 255)).join(',')}), rgb(${preset.skyHorizon.map((c) => Math.round(c * 255)).join(',')}))`}
        ></span>
      </button>
    {/each}
  </div>
  <p class="hint">切换时太阳方位与高度角平滑过渡，云团明暗、地面投影与雾色同步更新。</p>
</section>

<style>
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
    margin-bottom: 10px;
  }

  .preset-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 10px 4px 8px;
    border-radius: 9px;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-card:hover {
    border-color: rgba(93, 180, 255, 0.45);
    color: var(--text);
  }

  .preset-card.active {
    border-color: var(--accent);
    background: rgba(93, 180, 255, 0.14);
    color: var(--text);
  }

  .preset-icon {
    font-size: 18px;
  }

  .swatch {
    width: 100%;
    height: 6px;
    border-radius: 4px;
    opacity: 0.9;
  }
</style>
