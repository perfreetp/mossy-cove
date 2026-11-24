import { writable } from 'svelte/store';

export const toastState = writable(null);
let timer = null;

export function showToast(message, type = 'info') {
  toastState.set({ message, type, at: Date.now() });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => toastState.set(null), 2800);
}
