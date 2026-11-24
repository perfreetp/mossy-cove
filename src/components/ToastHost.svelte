<script lang="ts">
  import { toastBus } from '../lib/toast.svelte';

  const color: Record<string, string> = {
    info: '#38bdf8',
    success: '#22c55e',
    error: '#ef4444'
  };
</script>

<div class="toast-host">
  {#each toastBus.items as t (t.id)}
    <div class="toast" style={`border-color:${color[t.kind]}`}>
      <span class="dot" style={`background:${color[t.kind]}`}></span>
      {t.message}
    </div>
  {/each}
</div>

<style>
.toast-host {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid;
  border-radius: 8px;
  padding: 9px 16px;
  max-width: 520px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  gap: 9px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
</style>
