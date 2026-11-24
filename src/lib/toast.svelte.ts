/** 轻量全局提示 */
export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

class ToastBus {
  items = $state<Toast[]>([]);
  private seq = 0;

  show(message: string, kind: Toast['kind'] = 'info', duration = 3200): void {
    const id = ++this.seq;
    this.items = [...this.items, { id, kind, message }];
    setTimeout(() => {
      this.items = this.items.filter((t) => t.id !== id);
    }, duration);
  }

  info(msg: string): void {
    this.show(msg, 'info');
  }
  success(msg: string): void {
    this.show(msg, 'success');
  }
  error(msg: string): void {
    this.show(msg, 'error', 5000);
  }
}

export const toastBus = new ToastBus();
