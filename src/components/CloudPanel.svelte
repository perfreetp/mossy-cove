<script lang="ts">
  import { editor, editorView } from '../editor';
  import type { CloudTier } from '../lib/clouds';

  $: state = $editorView.cloudState;
  $: count = $editorView.cloudCount;
  $: selectedId = $editorView.selectedId;
  $: mode = $editorView.mode;
  $: selected = state.blobs.find((b) => b.id === selectedId) ?? null;

  const tierLabels: Record<'density' | 'thickness' | 'height', string> = {
    density: '密度',
    thickness: '厚度',
    height: '高度'
  };
  const tierKeys: Array<'density' | 'thickness' | 'height'> = ['density', 'thickness', 'height'];
  const tiers: CloudTier[] = [1, 2, 3];

  function pickTier(key: 'density' | 'thickness' | 'height', tier: CloudTier): void {
    if (selectedId) editor.setCloudTier(selectedId, key, tier);
  }

  function onCountChange(e: Event): void {
    editor.setCloudCount(Number((e.target as HTMLInputElement).value));
  }

  let clingStart = $editorView.cloudState.cling;

  function startCling(): void {
    clingStart = $editorView.cloudState.cling;
  }

  function onClingInput(e: Event): void {
    editor.setClingLive(Number((e.target as HTMLInputElement).value));
  }

  function onClingChange(): void {
    editor.commitClingChange(clingStart);
  }
</script>

<section class="panel-section">
  <h3 class="section-title">云层环绕</h3>

  <div class="slider-row">
    <div class="slider-head">
      <label for="cl-count">云团数量</label>
      <output>{count}</output>
    </div>
    <input
      id="cl-count"
      type="range"
      min="4"
      max="80"
      step="1"
      value={count}
      on:change={onCountChange}
    />
  </div>

  <div class="slider-row">
    <div class="slider-head">
      <label for="cl-cling">地形贴合程度</label>
      <output>{Math.round(state.cling * 100)}%</output>
    </div>
    <input
      id="cl-cling"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={state.cling}
      on:pointerdown={startCling}
      on:input={onClingInput}
      on:change={onClingChange}
    />
  </div>

  <div class="btn-group" style="margin-bottom: 10px">
    <button class="btn tiny" on:click={() => editor.redistribute()}>🔄 重新环绕分布</button>
    <button class="btn tiny" on:click={() => editor.addCloud()}>＋ 新增云团</button>
  </div>

  <div class="segmented" style="margin-bottom: 10px">
    <button class:active={mode === 'cloud'} on:click={() => editor.setMode('cloud')}>
      ☁ 云团拖拽模式
    </button>
    <button class:active={mode === 'camera'} on:click={() => editor.setMode('camera')}>
      🎥 视角模式
    </button>
  </div>

  {#if selected}
    <div class="tier-box">
      <div class="tier-title">
        选中云团 <span class="tag">#{state.blobs.indexOf(selected) + 1}</span>
        {#if selected.locked}<span class="tag lock">已锁定</span>{/if}
      </div>
      {#each tierKeys as k}
        <div class="tier-row">
          <span>{tierLabels[k]}</span>
          <div class="tier-picker">
            {#each tiers as tier}
              <button
                class:active={selected[k] === tier}
                on:click={() => pickTier(k, tier)}
              >
                {tier} 档
              </button>
            {/each}
          </div>
        </div>
      {/each}
      <button class="btn tiny danger" style="width:100%;margin-top:8px" on:click={() => editor.deleteSelected()}>
        删除该云团
      </button>
    </div>
  {:else}
    <p class="hint">在视图中点选云团，或从右侧列表选择，即可调整密度 / 厚度 / 高度三个档位。拖拽时自动保持最小间距。</p>
  {/if}
</section>

<style>
  .tier-box {
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid var(--panel-border);
    border-radius: 9px;
    padding: 10px;
  }

  .tier-title {
    font-weight: 700;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tag {
    font-size: 10px;
    background: rgba(93, 180, 255, 0.2);
    color: var(--accent);
    padding: 2px 7px;
    border-radius: 10px;
  }

  .tag.lock {
    background: rgba(255, 176, 103, 0.18);
    color: var(--warm);
  }

  .tier-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .tier-row > span {
    width: 34px;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
