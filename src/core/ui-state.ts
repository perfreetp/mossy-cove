import { BRUSH_RADII } from './config';
import type { ToolId } from './types';

interface UiState {
  tool: ToolId;
  brushTier: number;
}

type UiListener = (s: UiState) => void;

/** 不入历史的界面状态：当前工具、笔刷档位 */
class UiStateStore {
  state: UiState = { tool: 'pan', brushTier: 1 };
  private listeners = new Set<UiListener>();

  subscribe(fn: UiListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  setTool(tool: ToolId): void {
    if (this.state.tool === tool) return;
    this.state = { ...this.state, tool };
    this.emit();
  }

  setBrushTier(tier: number): void {
    const t = Math.max(0, Math.min(BRUSH_RADII.length - 1, tier));
    if (this.state.brushTier === t) return;
    this.state = { ...this.state, brushTier: t };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export const uiState = new UiStateStore();
