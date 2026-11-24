<script lang="ts">
  import { store } from '../store.svelte';
  import { EVIDENCE_META } from '../lib/evidence';
  import { PlanMapBridge } from '../lib/bridge.svelte';
  import { Vector3 } from 'three';
  import type { EvidenceType } from '../types';

  let editingNote = $state<string | null>(null);
  let noteDraft = $state('');

  function focus(id: string) {
    PlanMapBridge.threeManager?.focusMarker(id);
  }

  function startNote(id: string, current: string) {
    editingNote = id;
    noteDraft = current;
  }

  function saveNote(id: string) {
    store.updateMarkerNote(id, noteDraft);
    editingNote = null;
  }

  function changeType(id: string, e: Event) {
    store.updateMarkerType(id, (e.currentTarget as HTMLSelectElement).value as EvidenceType);
  }

  function locateOnMap(id: string) {
    const m = store.markers.find((x) => x.id === id);
    if (m) PlanMapBridge.threeManager?.flyTo(new Vector3(m.position.x, m.position.y, m.position.z));
  }
</script>

<div class="evidence-tab">
  <div class="section toolbar-row">
    <button onclick={() => store.undoMarker()} disabled={!store.markerCanUndo}>↶ 撤销</button>
    <button onclick={() => store.redoMarker()} disabled={!store.markerCanRedo}>↷ 重做</button>
    <span class="muted">拖动三维/平面图中的标记可重新定位</span>
  </div>

  {#if store.markers.length === 0}
    <div class="empty">
      暂无证据标记。<br />
      点击左上「📌 放置证据」，选择类型后在三维点云表面点击即可放置；标记会带类型编号，并在平面图同步投影。
    </div>
  {/if}

  <div class="mk-list">
    {#each store.markers as m (m.id)}
      {@const meta = EVIDENCE_META[m.type]}
      <div class="mk-item">
        <div class="mk-head">
          <span class="badge" style={`background:${meta.color}`}>{meta.icon}{m.seq}</span>
          <select value={m.type} onchange={(e) => changeType(m.id, e)}>
            {#each Object.values(EVIDENCE_META) as opt (opt.type)}
              <option value={opt.type}>{opt.label}</option>
            {/each}
          </select>
          <div class="spacer"></div>
          <button class="ghost small" onclick={() => focus(m.id)}>定位</button>
          <button class="ghost danger small" onclick={() => store.removeMarker(m.id)}>删除</button>
        </div>
        <div class="coords muted">
          X {m.position.x.toFixed(2)} · Y {m.position.y.toFixed(2)} · Z {m.position.z.toFixed(2)}
        </div>
        {#if editingNote === m.id}
          <div class="note-edit">
            <textarea rows="2" bind:value={noteDraft} placeholder="勘验备注…"></textarea>
            <div class="row">
              <button class="primary small" onclick={() => saveNote(m.id)}>保存</button>
              <button class="small" onclick={() => (editingNote = null)}>取消</button>
            </div>
          </div>
        {:else}
          <button class="ghost note-btn" onclick={() => startNote(m.id, m.note)}>
            {m.note ? `备注：${m.note}` : '＋ 添加勘验备注'}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
.evidence-tab {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.toolbar-row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.mk-list {
  overflow-y: auto;
  padding: 8px 10px 14px;
  flex: 1;
}
.mk-item {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px;
  margin-bottom: 8px;
  background: var(--bg-800);
}
.mk-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  color: #fff;
  font-weight: 700;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.coords {
  font-size: 11px;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.note-btn {
  margin-top: 6px;
  width: 100%;
  text-align: left;
  color: var(--text-300);
  font-size: 11px;
}
.note-edit textarea {
  width: 100%;
  margin-top: 6px;
  resize: vertical;
}
.note-edit .row {
  margin-top: 6px;
  gap: 6px;
}
.small {
  padding: 3px 8px;
  font-size: 11px;
}
.empty {
  padding: 26px 18px;
  color: var(--text-500);
  line-height: 1.8;
  font-size: 12px;
}
</style>
