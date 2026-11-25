import { BUSH_VARIANTS, TREE_VARIANTS } from '../core/scatter';

export const FRAME = 128;
export const ATLAS_COLS = TREE_VARIANTS + BUSH_VARIANTS; // 单行图集

type Ctx = CanvasRenderingContext2D;

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawShadow(ctx: Ctx, y: number, rx: number, ry: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(18, 28, 16, 0.28)';
  ellipse(ctx, 0, y, rx, ry, 'rgba(18,28,16,0.28)');
  ctx.restore();
}

interface Palette {
  dark: string;
  mid: string;
  light: string;
  hi: string;
}

const TREE_PALETTES: Palette[] = [
  { dark: '#27602f', mid: '#3c8f47', light: '#57b35f', hi: '#8fd98a' },
  { dark: '#1f5a3c', mid: '#2f8a5b', light: '#46b077', hi: '#86d6a6' },
  { dark: '#3c6b22', mid: '#5c9a32', light: '#7cb84a', hi: '#b6dd7e' },
  { dark: '#5a4a1d', mid: '#8a7a2e', light: '#b3a23f', hi: '#ddd07a' }, // 秋色
  { dark: '#6e2f24', mid: '#a84b32', light: '#cf6d45', hi: '#eca46f' }, // 红叶
];

const BUSH_PALETTES: Palette[] = [
  { dark: '#3a7328', mid: '#57a03a', light: '#7cc457', hi: '#b5e28c' },
  { dark: '#2f6b39', mid: '#4c9a52', light: '#71bd6e', hi: '#a9dd9a' },
  { dark: '#5c7a23', mid: '#83a832', light: '#a6c94e', hi: '#d3e787' },
  { dark: '#356b4a', mid: '#4d9870', light: '#74bd92', hi: '#a6dcbf' },
];

/** 树冠：多层重叠圆球 + 高光 */
function drawTree(ctx: Ctx, variant: number): void {
  const p = TREE_PALETTES[variant % TREE_PALETTES.length];
  drawShadow(ctx, 44, 34, 12);

  // 树干
  ctx.fillStyle = '#6b4729';
  ctx.beginPath();
  ctx.moveTo(-6, 18);
  ctx.lineTo(6, 18);
  ctx.lineTo(8, 46);
  ctx.lineTo(-8, 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 20, 8, 26);

  // 树冠底层大团
  const blobs: Array<[number, number, number]> = [
    [0, -14, 34],
    [-22, 0, 24],
    [22, 0, 25],
    [-10, 10, 24],
    [13, 11, 22],
  ];
  for (const [x, y, r] of blobs) circle(ctx, x, y + 4, r, p.dark);
  for (const [x, y, r] of blobs) circle(ctx, x - 2, y, r * 0.92, p.mid);

  // 亮部团块
  const lights: Array<[number, number, number]> = [
    [-10, -20, 17],
    [12, -16, 15],
    [-20, -2, 12],
    [16, 2, 12],
    [0, -4, 16],
  ];
  for (const [x, y, r] of lights) circle(ctx, x, y, r, p.light);

  // 顶部高光点
  circle(ctx, -12, -24, 7, p.hi);
  circle(ctx, 8, -19, 5, p.hi);
  circle(ctx, -2, -8, 5, p.light);
}

/** 灌木：低矮团簇，部分变体带花/果 */
function drawBush(ctx: Ctx, variant: number): void {
  const p = BUSH_PALETTES[variant % BUSH_PALETTES.length];
  drawShadow(ctx, 40, 32, 10);

  const blobs: Array<[number, number, number]> = [
    [-18, 22, 18],
    [18, 22, 18],
    [0, 14, 24],
    [-6, 28, 18],
    [10, 29, 16],
  ];
  for (const [x, y, r] of blobs) circle(ctx, x, y + 3, r, p.dark);
  for (const [x, y, r] of blobs) circle(ctx, x, y, r * 0.9, p.mid);

  const lights: Array<[number, number, number]> = [
    [-8, 10, 11],
    [9, 12, 10],
    [0, 22, 12],
  ];
  for (const [x, y, r] of lights) circle(ctx, x, y, r, p.light);
  circle(ctx, -9, 8, 4, p.hi);
  circle(ctx, 8, 10, 3, p.hi);

  // 第 4 个灌木变体带红色浆果 / 花
  if (variant % BUSH_VARIANTS === 3) {
    const berries: Array<[number, number]> = [
      [-14, 18],
      [6, 8],
      [15, 22],
      [-2, 26],
      [-19, 28],
      [12, 30],
    ];
    for (const [x, y] of berries) {
      circle(ctx, x, y, 3.4, '#e0524d');
      circle(ctx, x - 1, y - 1, 1.2, '#ffb3ae');
    }
  } else if (variant % BUSH_VARIANTS === 2) {
    const flowers: Array<[number, number]> = [
      [-12, 14],
      [8, 18],
      [2, 8],
      [16, 28],
    ];
    for (const [x, y] of flowers) circle(ctx, x, y, 2.8, '#f4e38a');
  }
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** 每个变体在图集中的帧矩形 [x, y, size] */
  frames: Array<{ x: number; y: number; size: number }>;
  treeFrameCount: number;
  bushFrameStart: number;
}

/** 构建单行植被图集（所有精灵共享同一纹理源，利于合批） */
export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME * ATLAS_COLS;
  canvas.height = FRAME;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const frames: Atlas['frames'] = [];
  for (let i = 0; i < ATLAS_COLS; i++) {
    ctx.save();
    ctx.translate(i * FRAME + FRAME / 2, FRAME / 2 + 6);
    if (i < TREE_VARIANTS) drawTree(ctx, i);
    else drawBush(ctx, i - TREE_VARIANTS);
    ctx.restore();
    frames.push({ x: i * FRAME, y: 0, size: FRAME });
  }

  return {
    canvas,
    frames,
    treeFrameCount: TREE_VARIANTS,
    bushFrameStart: TREE_VARIANTS,
  };
}
