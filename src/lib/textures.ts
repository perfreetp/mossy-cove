import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * 程序化纹理：云团绒球贴图与云影贴图，
 * 全部由 Canvas 2D 径向渐变生成，不依赖外部资源。
 */

function makeRadialTexture(
  scene: Scene,
  name: string,
  size: number,
  paint: (ctx: CanvasRenderingContext2D, c: number) => void
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  paint(ctx, size / 2);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** 云朵贴图：多层柔光叠加，边缘羽化。 */
export function createCloudPuffTexture(scene: Scene): DynamicTexture {
  return makeRadialTexture(scene, 'tex-cloud-puff', 256, (ctx, c) => {
    const grad = ctx.createRadialGradient(c, c * 0.92, c * 0.08, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    grad.addColorStop(0.68, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c * 2, c * 2);

    // 再加两团偏心柔光，打破完美圆形
    for (const [ox, oy, r, alpha] of [
      [-0.28, 0.12, 0.5, 0.4],
      [0.3, 0.18, 0.42, 0.36]
    ] as const) {
      const g2 = ctx.createRadialGradient(
        c + ox * c,
        c + oy * c,
        2,
        c + ox * c,
        c + oy * c,
        r * c
      );
      g2.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, c * 2, c * 2);
    }
  });
}

/** 云影贴图：柔和椭圆暗斑。 */
export function createCloudShadowTexture(scene: Scene): DynamicTexture {
  return makeRadialTexture(scene, 'tex-cloud-shadow', 256, (ctx, c) => {
    const grad = ctx.createRadialGradient(c, c, c * 0.05, c, c, c);
    grad.addColorStop(0, 'rgba(20,22,30,0.55)');
    grad.addColorStop(0.5, 'rgba(20,22,30,0.28)');
    grad.addColorStop(1, 'rgba(20,22,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c * 2, c * 2);
  });
}

/** 笔刷光标贴图：同心圆环。 */
export function createBrushCursorTexture(scene: Scene): DynamicTexture {
  const tex = makeRadialTexture(scene, 'tex-brush-cursor', 256, (ctx, c) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  });
  tex.getAlphaFromRGB = false;
  return tex;
}
