<script setup lang="ts">
import { dismissToast, state } from '../state/controller'
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <div v-for="toast in state.toasts" :key="toast.id" class="toast" :class="toast.type">
      {{ toast.message }}
      <button class="toast-close" @click="dismissToast(toast.id)">×</button>
    </div>
  </div>
</template>
