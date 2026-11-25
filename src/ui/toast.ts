/** 轻量全局提示 */
export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info', duration = 2600): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? '' : type}`.trim();
  el.textContent = message;
  el.dataset.testid = 'toast-item';
  root.appendChild(el);
  window.setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    window.setTimeout(() => el.remove(), 260);
  }, duration);
}
