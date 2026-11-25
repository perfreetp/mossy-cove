import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { BRUSH_RADII, VIEW_W, VIEW_H, WORLD } from '../core/config';
import type { ProjectState, ScatterZone, ToolId } from '../core/types';
import { buildAtlas } from './atlas';
import { paintTerrainCanvas } from './terrain-paint';
import type { Heightfield } from '../core/terrain';

export interface TerrainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SceneCallbacks {
  onZoneComplete?: (rect: TerrainRect) => void;
  onEraseBegin?: () => void;
  onEraseDabs?: (dabs: Array<{ x: number; y: number; r: number }>) => void;
  onEraseEnd?: () => void;
}

interface Pool {
  free: PooledSprite[];
  used: Map<number, PooledSprite>;
}

interface PooledSprite extends Sprite {
  __variant?: number;
  __layer?: 'trees' | 'bushes';
}

const TREE_SCALE_DIV = 150;
const BUSH_SCALE_DIV = 108;
const TREE_ANCHOR_Y = 0.88;
const BUSH_ANCHOR_Y = 0.8;

/** Pixi + pixi-viewport 渲染层：地形、区域框、植被实例池、擦除光标 */
export class VegetationScene {
  private host: HTMLElement;
  private app!: Application;
  private viewport!: Viewport;
  private worldRoot = new Container();
  private frameGfx = new Graphics();
  private terrainSprite: Sprite | null = null;
  private terrainTexture: Texture | null = null;

  private zoneFillGfx = new Graphics();
  private zoneBorderGfx = new Graphics();
  private zoneLabelLayer = new Container();
  private previewGfx = new Graphics();
  private cursorGfx = new Graphics();

  private treeLayer = new Container();
  private bushLayer = new Container();

  private frameTextures: Texture[] = [];
  private bushFrameStart = 0;

  private pools: Record<'trees' | 'bushes', Pool> = {
    trees: { free: [], used: new Map() },
    bushes: { free: [], used: new Map() },
  };
  private zoneSignature = '';
  private tool: ToolId = 'pan';
  private brushRadius: number = BRUSH_RADII[1];
  private callbacks: SceneCallbacks = {};

  private ro: ResizeObserver | null = null;
  private disposed = false;

  // 指针交互状态
  private pointerDown = false;
  private drawStart: { x: number; y: number } | null = null;
  private eraseLast: { x: number; y: number } | null = null;

  constructor(host: HTMLElement, callbacks: SceneCallbacks = {}) {
    this.host = host;
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);

    this.app = new Application();
    await this.app.init({
      width,
      height,
      background: '#10171f',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    if (this.disposed) return;
    this.app.canvas.dataset.testid = 'pixi-canvas';
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.display = 'block';
    this.host.appendChild(this.app.canvas);

    // 植被图集与帧纹理（共享同一 texture source，利于合批）
    const atlas = buildAtlas();
    const atlasTexture = Texture.from(atlas.canvas);
    this.bushFrameStart = atlas.bushFrameStart;
    this.frameTextures = atlas.frames.map(
      (f) =>
        new Texture({
          source: atlasTexture.source,
          frame: new Rectangle(f.x, f.y, f.size, f.size),
        }),
    );

    this.viewport = new Viewport({
      screenWidth: width,
      screenHeight: height,
      worldWidth: VIEW_W,
      worldHeight: VIEW_H,
      events: this.app.renderer.events,
      passiveWheel: false,
      disableOnContextMenu: true,
    });
    this.app.stage.addChild(this.viewport);

    this.viewport
      .drag({ pressDrag: true, wheel: false })
      .pinch()
      .wheel({ percent: 0.14, smooth: 6 })
      .decelerate({ friction: 0.94 })
      .clamp({ left: -120, top: -120, right: VIEW_W + 120, bottom: VIEW_H + 120 })
      .clampZoom({ minWidth: 240, maxWidth: Math.max(VIEW_W, VIEW_H) * 2.4 });

    this.viewport.addChild(this.frameGfx);
    this.worldRoot.position.set(WORLD.frame, WORLD.frame);
    this.viewport.addChild(this.worldRoot);

    this.worldRoot.addChild(
      this.zoneFillGfx,
      this.zoneBorderGfx,
      this.zoneLabelLayer,
      this.bushLayer,
      this.treeLayer,
      this.previewGfx,
      this.cursorGfx,
    );

    this.drawFrame();
    this.bindPointer();

    this.ro = new ResizeObserver(() => this.handleResize());
    this.ro.observe(this.host);

    // 初始适配
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.viewport.resize(
        this.host.clientWidth,
        this.host.clientHeight,
        VIEW_W,
        VIEW_H,
      );
      this.viewport.fit(true, VIEW_W, VIEW_H);
    });
  }

  setCallbacks(cb: SceneCallbacks): void {
    this.callbacks = cb;
  }

  // ---------------------------------------------------------------
  // 地形
  // ---------------------------------------------------------------
  setTerrain(hf: Heightfield): void {
    const canvas = paintTerrainCanvas(hf);
    const tex = Texture.from(canvas);
    if (!this.terrainSprite) {
      this.terrainSprite = new Sprite(tex);
      this.terrainSprite.width = WORLD.w;
      this.terrainSprite.height = WORLD.h;
      this.worldRoot.addChildAt(this.terrainSprite, 0);
    } else {
      const old = this.terrainTexture;
      this.terrainSprite.texture = tex;
      this.terrainSprite.width = WORLD.w;
      this.terrainSprite.height = WORLD.h;
      old?.destroy(true);
    }
    this.terrainTexture = tex;
  }

  private drawFrame(): void {
    const g = this.frameGfx;
    g.clear();
    // 投影
    g.roundRect(20, 26, VIEW_W - 24, VIEW_H - 24, 34).fill({ color: 0x000000, alpha: 0.34 });
    g.roundRect(14, 18, VIEW_W - 22, VIEW_H - 22, 32).fill({ color: 0x000000, alpha: 0.22 });
    // 木框主体
    g.roundRect(6, 6, VIEW_W - 12, VIEW_H - 12, 30).fill({ color: 0x7c5837 });
    g.roundRect(6, 6, VIEW_W - 12, VIEW_H - 12, 30).stroke({ width: 3, color: 0x9a744c, alpha: 0.9 });
    // 木纹内层
    g.roundRect(20, 20, VIEW_W - 40, VIEW_H - 40, 22).fill({ color: 0x68472b });
    // 地形凹槽压边
    g
      .roundRect(
        WORLD.frame - 10,
        WORLD.frame - 10,
        WORLD.w + 20,
        WORLD.h + 20,
        16,
      )
      .fill({ color: 0x2e1f12 });
    g
      .roundRect(
        WORLD.frame - 2,
        WORLD.frame - 2,
        WORLD.w + 4,
        WORLD.h + 4,
        8,
      )
      .stroke({ width: 2, color: 0xa8835a, alpha: 0.5 });
  }

  // ---------------------------------------------------------------
  // 工具与指针
  // ---------------------------------------------------------------
  setTool(tool: ToolId): void {
    this.tool = tool;
    if (!this.viewport) return;
    if (tool === 'pan') this.viewport.plugins.resume('drag');
    else this.viewport.plugins.pause('drag');

    if (tool !== 'erase') {
      this.cursorGfx.clear();
      this.cursorGfx.visible = false;
    }
    if (tool !== 'zone') {
      this.previewGfx.clear();
      this.previewGfx.visible = false;
    }
    this.app.canvas.style.cursor =
      tool === 'pan' ? 'grab' : tool === 'zone' ? 'crosshair' : 'none';
  }

  setBrushRadius(r: number): void {
    this.brushRadius = r;
  }

  private handleResize(): void {
    if (!this.app || this.disposed) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    this.app.renderer.resize(w, h);
    this.viewport.resize(w, h, VIEW_W, VIEW_H);
  }

  zoomBy(factor: number): void {
    if (!this.viewport) return;
    const next = Math.max(0.12, Math.min(4, this.viewport.scaled * factor));
    this.viewport.setZoom(next, true);
  }

  resetView(): void {
    if (!this.viewport) return;
    this.viewport.fit(true, VIEW_W, VIEW_H);
  }

  focusRect(r: TerrainRect): void {
    if (!this.viewport) return;
    const cx = WORLD.frame + r.x + r.w / 2;
    const cy = WORLD.frame + r.y + r.h / 2;
    const scale = Math.min(
      this.host.clientWidth / (r.w + 220),
      this.host.clientHeight / (r.h + 220),
      1.6,
    );
    this.viewport.animate?.({ time: 260, position: { x: cx, y: cy }, scale });
    if (!this.viewport.animate) {
      this.viewport.moveCenter(cx, cy).setZoom(scale, true);
    }
  }

  /** 客户端坐标 -> 地形局部坐标 */
  clientToTerrain(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const w = this.viewport.toWorld(sx, sy);
    return { x: w.x - WORLD.frame, y: w.y - WORLD.frame };
  }

  /** 地形局部坐标 -> 客户端视口坐标（主要用于自动化验证） */
  terrainToClient(x: number, y: number): { x: number; y: number } {
    const p = this.viewport.toScreen(x + WORLD.frame, y + WORLD.frame);
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  private bindPointer(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  private onPointerLeave = (): void => {
    if (this.tool === 'erase' && !this.pointerDown) {
      this.cursorGfx.visible = false;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.tool === 'pan') return;
    e.preventDefault();
    try {
      this.app.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const p = this.clientToTerrain(e.clientX, e.clientY);
    this.pointerDown = true;

    if (this.tool === 'zone') {
      this.drawStart = p;
      this.previewGfx.visible = true;
      this.drawZonePreview(p, p);
    } else if (this.tool === 'erase') {
      this.eraseLast = p;
      this.callbacks.onEraseBegin?.();
      this.callbacks.onEraseDabs?.([{ x: p.x, y: p.y, r: this.brushRadius }]);
      this.drawCursor(p);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.viewport) return;
    const p = this.clientToTerrain(e.clientX, e.clientY);

    if (this.tool === 'erase') {
      this.cursorGfx.visible = true;
      this.drawCursor(p);
    }

    if (!this.pointerDown) return;

    if (this.tool === 'zone' && this.drawStart) {
      this.drawZonePreview(this.drawStart, p);
    } else if (this.tool === 'erase' && this.eraseLast) {
      const dabs = this.interpolateDabs(this.eraseLast, p, this.brushRadius);
      if (dabs.length) this.callbacks.onEraseDabs?.(dabs);
      this.eraseLast = p;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    try {
      this.app.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    if (this.tool === 'zone' && this.drawStart) {
      const p = this.clientToTerrain(e.clientX, e.clientY);
      const x = Math.min(this.drawStart.x, p.x);
      const y = Math.min(this.drawStart.y, p.y);
      const w = Math.abs(p.x - this.drawStart.x);
      const h = Math.abs(p.y - this.drawStart.y);
      this.drawStart = null;
      this.previewGfx.clear();
      this.previewGfx.visible = false;
      if (w >= 28 && h >= 28) {
        this.callbacks.onZoneComplete?.({
          x: Math.max(0, x),
          y: Math.max(0, y),
          w: Math.min(w, WORLD.w - Math.max(0, x)),
          h: Math.min(h, WORLD.h - Math.max(0, y)),
        });
      }
    } else if (this.tool === 'erase') {
      this.eraseLast = null;
      this.callbacks.onEraseEnd?.();
    }
  };

  /** 在两点之间按笔刷半径插值，避免快速拖动留下空隙 */
  private interpolateDabs(
    a: { x: number; y: number },
    b: { x: number; y: number },
    r: number,
  ): Array<{ x: number; y: number; r: number }> {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(6, r * 0.32);
    if (dist < step) return [{ x: b.x, y: b.y, r }];
    const n = Math.min(60, Math.floor(dist / step));
    const dabs: Array<{ x: number; y: number; r: number }> = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      dabs.push({ x: a.x + dx * t, y: a.y + dy * t, r });
    }
    return dabs;
  }

  private drawCursor(p: { x: number; y: number }): void {
    const g = this.cursorGfx;
    g.clear();
    g.circle(p.x, p.y, this.brushRadius).fill({ color: 0xff8a5c, alpha: 0.12 });
    g
      .circle(p.x, p.y, this.brushRadius)
      .stroke({ width: 2 / this.viewport.scaled, color: 0xffb199, alpha: 0.95 });
    g.circle(p.x, p.y, 2.5).fill({ color: 0xffd2c4 });
  }

  private drawZonePreview(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): void {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    const g = this.previewGfx;
    g.clear();
    g.rect(x, y, w, h).fill({ color: 0x67e8f9, alpha: 0.1 });
    this.dashedRect(g, x, y, w, h, 14, 9);
    g.stroke({ width: 2, color: 0x86e9ff, alpha: 0.95 });
  }

  /** 向 Graphics 当前路径追加虚线段（之后统一 stroke） */
  private dashedRect(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    dash: number,
    gap: number,
  ): void {
    const seg = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const dx = (x1 - x0) / len;
      const dy = (y1 - y0) / len;
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(d + dash, len);
        g.moveTo(x0 + dx * d, y0 + dy * d);
        g.lineTo(x0 + dx * e, y0 + dy * e);
      }
    };
    seg(x, y, x + w, y);
    seg(x + w, y, x + w, y + h);
    seg(x + w, y + h, x, y + h);
    seg(x, y + h, x, y);
  }

  // ---------------------------------------------------------------
  // 区域覆盖层
  // ---------------------------------------------------------------
  private syncZones(zones: ScatterZone[]): void {
    const sig = JSON.stringify(
      zones.map((z) => [z.id, z.x, z.y, z.w, z.h, z.name]),
    );
    if (sig === this.zoneSignature) return;
    this.zoneSignature = sig;

    const fill = this.zoneFillGfx;
    const border = this.zoneBorderGfx;
    fill.clear();
    border.clear();
    this.zoneLabelLayer.removeChildren().forEach((c) => c.destroy({ children: true }));

    zones.forEach((z, i) => {
      fill.rect(z.x, z.y, z.w, z.h).fill({ color: 0x7fe3c0, alpha: 0.05 });
      this.dashedRect(border, z.x, z.y, z.w, z.h, 16, 10);
      border.stroke({
        width: 2.5,
        color: i === 0 ? 0x6fe3b0 : 0x67c9ff,
        alpha: 0.85,
      });

      // 角点
      const cs = 7;
      const corners: Array<[number, number]> = [
        [z.x, z.y],
        [z.x + z.w, z.y],
        [z.x, z.y + z.h],
        [z.x + z.w, z.y + z.h],
      ];
      for (const [cx, cy] of corners) {
        border.rect(cx - cs / 2, cy - cs / 2, cs, cs).fill({ color: 0xd8fff0 });
      }

      const label = new Text({
        text: z.name,
        style: {
          fontSize: 15,
          fontWeight: '700',
          fill: 0xeafff6,
          letterSpacing: 1,
        },
      });
      label.anchor.set(0, 0.5);
      label.x = z.x + 12;
      label.y = z.y + 20;

      const pill = new Graphics();
      const pw = label.width + 22;
      pill
        .roundRect(z.x + 6, z.y + 6, pw, 28, 8)
        .fill({ color: 0x12241d, alpha: 0.72 })
        .stroke({ width: 1, color: 0x6fe3b0, alpha: 0.4 });

      const wrap = new Container();
      wrap.addChild(pill, label);
      this.zoneLabelLayer.addChild(wrap);
    });
  }

  // ---------------------------------------------------------------
  // 实例同步 + 对象池 + 高度带回收
  // ---------------------------------------------------------------
  sync(state: ProjectState): void {
    if (!this.app) return;
    this.syncZones(state.zones);
    this.treeLayer.visible = state.layers.trees.visible;
    this.bushLayer.visible = state.layers.bushes.visible;

    // 先把上一轮所有“使用中”的精灵归还到池并清空 id 映射。
    // 这样全量重撒（实例 id 全部更新）时，本轮就能直接复用旧精灵，
    // 避免“先取新精灵、后回收旧精灵”造成的精灵数量随调参不断膨胀。
    this.releaseAll('trees');
    this.releaseAll('bushes');

    const low = state.bandLow;
    const high = state.bandHigh;

    for (const inst of state.instances) {
      // 高度带之外：不取出，精灵留在池中即“隐藏并回收”
      if (inst.h < low || inst.h > high) continue;

      const s = this.acquire(inst.layer);
      this.pools[inst.layer].used.set(inst.id, s);

      const texIndex =
        inst.layer === 'trees'
          ? Math.min(inst.variant, this.bushFrameStart - 1)
          : this.bushFrameStart +
            Math.min(inst.variant, this.frameTextures.length - this.bushFrameStart - 1);
      if (s.__variant !== texIndex) {
        s.texture = this.frameTextures[texIndex];
        s.__variant = texIndex;
      }

      s.position.set(inst.x, inst.y);
      const div = inst.layer === 'trees' ? TREE_SCALE_DIV : BUSH_SCALE_DIV;
      s.scale.set(inst.size / div);
      s.rotation = inst.rot;
      s.anchor.set(0.5, inst.layer === 'trees' ? TREE_ANCHOR_Y : BUSH_ANCHOR_Y);
      s.tint = inst.layer === 'trees' ? TREE_TINTS[inst.id % 3] : BUSH_TINTS[inst.id % 3];
      s.alpha = 1;
    }
  }

  private releaseAll(layer: 'trees' | 'bushes'): void {
    const pool = this.pools[layer];
    for (const s of pool.used.values()) {
      s.visible = false;
      pool.free.push(s);
    }
    pool.used.clear();
  }

  private acquire(layer: 'trees' | 'bushes'): PooledSprite {
    const pool = this.pools[layer];
    let s = pool.free.pop();
    if (!s) {
      s = new Sprite() as PooledSprite;
      s.__layer = layer;
      s.eventMode = 'none';
      (layer === 'trees' ? this.treeLayer : this.bushLayer).addChild(s);
    }
    s.visible = true;
    return s;
  }

  getPoolStats(): {
    treeUsed: number;
    bushUsed: number;
    treeFree: number;
    bushFree: number;
  } {
    return {
      treeUsed: this.pools.trees.used.size,
      bushUsed: this.pools.bushes.used.size,
      treeFree: this.pools.trees.free.length,
      bushFree: this.pools.bushes.free.length,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.ro?.disconnect();
    const canvas = this.app?.canvas;
    canvas?.removeEventListener('pointerdown', this.onPointerDown);
    canvas?.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    canvas?.removeEventListener('pointerleave', this.onPointerLeave);
    this.app?.destroy(true, { children: true, texture: false });
  }
}

const TREE_TINTS = [0xffffff, 0xeaf7df, 0xdff2d2];
const BUSH_TINTS = [0xffffff, 0xf1f8e2, 0xe6f4d8];
