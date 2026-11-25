import { WORLD } from './config';
import type { EraseStroke } from './types';

/**
 * 擦除区域的栅格掩码。重散布时用 O(1) 查询避开被擦掉的地点，
 * 避免随着笔画增多逐落点遍历所有 dab。
 *
 * 盖章时把“与笔刷圆相交”的格子全部标记，查询只做点所在格判断，
 * 因此不会出现假阴性，边界处最多保守多让约一个格子。
 */
export class EraseMask {
  readonly cell = 6;
  readonly cols: number;
  readonly rows: number;
  readonly data: Uint8Array;

  constructor() {
    this.cols = Math.ceil(WORLD.w / this.cell) + 1;
    this.rows = Math.ceil(WORLD.h / this.cell) + 1;
    this.data = new Uint8Array(this.cols * this.rows);
  }

  stamp(wx: number, wy: number, r: number): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((wx - r) / c));
    const x1 = Math.min(this.cols - 1, Math.floor((wx + r) / c));
    const y0 = Math.max(0, Math.floor((wy - r) / c));
    const y1 = Math.min(this.rows - 1, Math.floor((wy + r) / c));
    const r2 = r * r;

    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        // 格子矩形上离圆心最近的点
        const rx = gx * c;
        const ry = gy * c;
        const nx = Math.max(rx, Math.min(wx, rx + c));
        const ny = Math.max(ry, Math.min(wy, ry + c));
        const dx = nx - wx;
        const dy = ny - wy;
        if (dx * dx + dy * dy <= r2) {
          this.data[gy * this.cols + gx] = 1;
        }
      }
    }
  }

  test(wx: number, wy: number): boolean {
    const gx = Math.floor(wx / this.cell);
    const gy = Math.floor(wy / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return false;
    return this.data[gy * this.cols + gx] === 1;
  }

  static fromStrokes(strokes: EraseStroke[]): EraseMask {
    const mask = new EraseMask();
    for (const stroke of strokes) {
      for (const dab of stroke.dabs) mask.stamp(dab.x, dab.y, dab.r);
    }
    return mask;
  }
}
