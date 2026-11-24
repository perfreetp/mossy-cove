<script>
  import {
    commit,
    commitCurrent,
    doc,
    FLOOR_COLORS,
    history,
    preview,
    setTransformMode,
    ui
  } from '../lib/store.js';

  const axes = [
    { key: 0, label: 'X', className: 'x' },
    { key: 1, label: 'Y', className: 'y' },
    { key: 2, label: 'Z', className: 'z' }
  ];

  let floor = $derived($doc.floors.find((item) => item.id === $ui.selectedFloorId) ?? null);

  function updateTransform(group, axisIndex, rawValue, commitAfter) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    preview((draft) => {
      const target = draft.floors.find((item) => item.id === $ui.selectedFloorId);
      if (!target) return;
      target[group][axisIndex] = group === 'scale' ? Math.max(0.08, value) : value;
    });

    if (commitAfter) {
      commitCurrent('精确编辑楼层', floor ? floor.name : '');
    }
  }

  function resetTransform() {
    if (!floor) return;
    commit('重置楼层变换', floor.name, (draft) => {
      const target = draft.floors[floor.index];
      target.position = [0, 0, 0];
      target.rotation = [0, 0, 0];
      target.scale = [1, 1, 1];
    });
  }
</script>

<section class="panel">
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-icon" style="color:#0f766e;background:#ccfbf1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </span>
      <h2 class="panel-title">单层编辑</h2>
    </div>
    {#if floor}
      <span class="panel-meta" style="color:{FLOOR_COLORS[floor.index % FLOOR_COLORS.length]}">●</span>
    {/if}
  </div>

  <div class="panel-body inspector">
    {#if !floor}
      <div class="empty-selection">
        在场景中点击楼层，或从左侧列表选择一层，即可单独平移、旋转、缩放、隐藏或抽离。
      </div>
    {:else}
      <div class="selected-summary">
        <span
          class="floor-swatch"
          style={`background:${FLOOR_COLORS[floor.index % FLOOR_COLORS.length]}`}
        ></span>
        <div style="min-width:0;">
          <div class="selected-name">{floor.name}</div>
          <div class="selected-sub">
            可直接拖拽场景 Gizmo，或在下方精确输入
          </div>
        </div>
      </div>

      <div class="segmented">
        <button
          class="btn"
          class:btn-active={$ui.transformMode === 'translate'}
          onclick={() => setTransformMode('translate')}
          title="平移 (W)"
        >
          平移
        </button>
        <button
          class="btn"
          class:btn-active={$ui.transformMode === 'rotate'}
          onclick={() => setTransformMode('rotate')}
          title="旋转 (E)"
        >
          旋转
        </button>
        <button
          class="btn"
          class:btn-active={$ui.transformMode === 'scale'}
          onclick={() => setTransformMode('scale')}
          title="缩放 (R)"
        >
          缩放
        </button>
      </div>

      {#key `transform-inputs-${$history.index}-${floor.id}`}
        <div class="control-block">
          <div class="control-label-row"><span>位置</span><span class="kbd">W</span></div>
          <div class="transform-grid">
            <span></span>
            {#each axes as axis (axis.key)}
              <span class={`axis-label ${axis.className}`}>{axis.label}</span>
            {/each}
            <span class="axis-label">位移</span>
            {#each axes as axis (axis.key)}
              <input
                type="number"
                step="0.1"
                defaultValue={floor.position[axis.key]}
                oninput={(event) => updateTransform('position', axis.key, event.currentTarget.value, false)}
                onchange={(event) => updateTransform('position', axis.key, event.currentTarget.value, true)}
              />
            {/each}
          </div>
        </div>

        <div class="control-block">
          <div class="control-label-row"><span>旋转（度）</span><span class="kbd">E</span></div>
          <div class="transform-grid">
            <span></span>
            {#each axes as axis (axis.key)}
              <span class={`axis-label ${axis.className}`}>{axis.label}</span>
            {/each}
            <span class="axis-label">角度</span>
            {#each axes as axis (axis.key)}
              <input
                type="number"
                step="5"
                defaultValue={floor.rotation[axis.key]}
                oninput={(event) => updateTransform('rotation', axis.key, event.currentTarget.value, false)}
                onchange={(event) => updateTransform('rotation', axis.key, event.currentTarget.value, true)}
              />
            {/each}
          </div>
        </div>

        <div class="control-block">
          <div class="control-label-row"><span>缩放</span><span class="kbd">R</span></div>
          <div class="transform-grid">
            <span></span>
            {#each axes as axis (axis.key)}
              <span class={`axis-label ${axis.className}`}>{axis.label}</span>
            {/each}
            <span class="axis-label">比例</span>
            {#each axes as axis (axis.key)}
              <input
                type="number"
                min="0.08"
                step="0.05"
                defaultValue={floor.scale[axis.key]}
                oninput={(event) => updateTransform('scale', axis.key, event.currentTarget.value, false)}
                onchange={(event) => updateTransform('scale', axis.key, event.currentTarget.value, true)}
              />
            {/each}
          </div>
        </div>
      {/key}

      <div class="inline-actions">
        <button class="btn" onclick={resetTransform}>重置变换</button>
        <button
          class="btn"
          onclick={() =>
            commit(floor.detached ? '楼层归位' : '抽离楼层', floor.name, (draft) => {
              draft.floors[floor.index].detached = !draft.floors[floor.index].detached;
            })}
        >
          {floor.detached ? '取消抽离' : '抽到旁边'}
        </button>
      </div>
    {/if}
  </div>
</section>
