<script>
  import { commit, commitCurrent, doc, history, preview } from '../lib/store.js';

  const directionPresets = [
    { label: '水平面', normal: [0, 1, 0] },
    { label: 'X 纵剖', normal: [1, 0, 0] },
    { label: 'Z 横剖', normal: [0, 0, 1] },
    { label: '任意斜面', normal: [1, 1, 0.65] }
  ];

  function previewDistance(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance)) return;
    preview((draft) => {
      draft.section.distance = distance;
    });
  }

  function commitDistance() {
    commitCurrent('移动剖切面', `距离 ${Number($doc.section.distance).toFixed(2)}`);
  }

  function previewNormal(index, raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    const next = [...$doc.section.normal];
    next[index] = value;
    const length = Math.hypot(next[0], next[1], next[2]);
    if (length > 1e-6) {
      preview((draft) => {
        draft.section.normal = [next[0] / length, next[1] / length, next[2] / length];
      });
    }
  }

  function commitNormal() {
    preview((draft) => {
      const n = draft.section.normal;
      const length = Math.hypot(n[0], n[1], n[2]) || 1;
      draft.section.normal = [n[0] / length, n[1] / length, n[2] / length];
    });
    commitCurrent(
      '设置剖切方向',
      `法向 (${$doc.section.normal.map((n) => n.toFixed(2)).join(', ')})`
    );
  }

  function chooseDirection(preset) {
    preview((draft) => {
      const length = Math.hypot(...preset.normal) || 1;
      draft.section.normal = preset.normal.map((value) => value / length);
    });
    commitCurrent('设置剖切方向', preset.label);
  }

  function toggleEnabled() {
    commit($doc.section.enabled ? '停用剖切' : '启用剖切', '', (draft) => {
      draft.section.enabled = !draft.section.enabled;
    });
  }

  function toggleHelper() {
    commit($doc.section.helper ? '隐藏剖切辅助面' : '显示剖切辅助面', '', (draft) => {
      draft.section.helper = !draft.section.helper;
    });
  }

  function previewThickness(value) {
    const thickness = Number(value);
    if (!Number.isFinite(thickness)) return;
    preview((draft) => {
      draft.section.thickness = thickness;
    });
  }
</script>

<section class="panel">
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-icon" style="color:#0284c7;background:#e0f2fe;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4h16v7H4z" />
          <path d="M4 13h16v7H4z" opacity=".45" />
          <path d="m8 8 8 8" />
          <path d="m16 8-8 8" />
        </svg>
      </span>
      <h2 class="panel-title">剖切控制面板</h2>
    </div>
    <span class="panel-meta">Manifold 实时封盖</span>
  </div>

  <div class="panel-body section-form">
    <div class="switch-row">
      <span>启用实体剖切</span>
      <button
        class="switch"
        class:on={$doc.section.enabled}
        role="switch"
        aria-checked={$doc.section.enabled}
        onclick={toggleEnabled}
        aria-label="启用实体剖切"
      ></button>
    </div>

    <div class="control-block">
      <div class="control-label-row">
        <span>移动距离 d</span>
        <span class="control-value">{Number($doc.section.distance).toFixed(2)}</span>
      </div>
      <div class="range-row">
        <input
          type="range"
          min="-20"
          max="30"
          step="0.05"
          value={$doc.section.distance}
          oninput={(event) => previewDistance(event.currentTarget.value)}
          onchange={commitDistance}
        />
        {#key `distance-${$history.index}`}
          <input
            type="number"
            min="-30"
            max="40"
            step="0.1"
            defaultValue={Number($doc.section.distance).toFixed(2)}
            oninput={(event) => previewDistance(event.currentTarget.value)}
            onchange={commitDistance}
          />
        {/key}
      </div>
      <div class="info-note">
        也可以拖动场景中剖切面末端的蓝色手柄，沿当前法向任意移动；一次拖动只记录一条撤销历史。
      </div>
    </div>

    <div class="control-block">
      <div class="control-label-row"><span>方向预设</span></div>
      <div class="preset-normal-grid">
        {#each directionPresets as preset}
          <button class="btn btn-small" onclick={() => chooseDirection(preset)}>{preset.label}</button>
        {/each}
      </div>
    </div>

    <div class="control-block">
      <div class="control-label-row">
        <span>任意法向向量</span>
        <span class="control-value">n · P = d</span>
      </div>
      {#key `normal-${$history.index}`}
        <div class="normal-grid">
          {#each ['x', 'y', 'z'] as axis, index}
            <label class={`vector-input ${axis}`}>
              <span>{axis.toUpperCase()}</span>
              <input
                type="number"
                step="0.1"
                defaultValue={Number($doc.section.normal[index]).toFixed(2)}
                oninput={(event) => previewNormal(index, event.currentTarget.value)}
                onchange={commitNormal}
              />
            </label>
          {/each}
        </div>
      {/key}
    </div>

    <div class="control-block">
      <div class="control-label-row">
        <span>截面薄实体厚度</span>
        <span class="control-value">{$doc.section.thickness.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min="0.03"
        max="0.28"
        step="0.01"
        value={$doc.section.thickness}
        oninput={(event) => previewThickness(event.currentTarget.value)}
        onchange={() => commitCurrent('调整截面封口厚度')}
      />
    </div>

    <div class="switch-row">
      <span>显示剖切面与手柄</span>
      <button
        class="switch"
        class:on={$doc.section.helper}
        role="switch"
        aria-checked={$doc.section.helper}
        onclick={toggleHelper}
        aria-label="显示剖切面辅助"
      ></button>
    </div>
  </div>
</section>
