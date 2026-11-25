import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

/** 生成程序化木纹贴图(沿画布 Y 方向的纹理,使用时按构件轴向旋转) */
export function createWoodTexture(base = '#b07a45', dark = '#7a4e26'): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, base);
  grad.addColorStop(0.5, lighten(base, 0.12));
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 细长木纹纤维:多条带正弦抖动的纵向条纹
  for (let i = 0; i < 90; i++) {
    const x0 = Math.random() * size;
    const amp = 2 + Math.random() * 7;
    const freq = 0.008 + Math.random() * 0.02;
    const phase = Math.random() * Math.PI * 2;
    ctx.beginPath();
    for (let y = 0; y <= size; y += 8) {
      const x = x0 + Math.sin(y * freq + phase) * amp + (Math.random() - 0.5) * 1.5;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(60, 35, 15, ${0.05 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.stroke();
  }

  // 木节
  for (let k = 0; k < 4; k++) {
    const kx = Math.random() * size;
    const ky = Math.random() * size;
    const r = 8 + Math.random() * 16;
    for (let ring = 0; ring < 4; ring++) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, r + ring * 4, (r + ring * 4) * 0.45, 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(55, 30, 12, ${0.22 - ring * 0.04})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 255 * amount);
  const g = Math.min(255, ((n >> 8) & 255) + 255 * amount);
  const b = Math.min(255, (n & 255) + 255 * amount);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export interface WoodMaterials {
  vertical: MeshStandardMaterial;
  horizontal: MeshStandardMaterial;
  cap: MeshStandardMaterial;
}

export function createWoodMaterials(): WoodMaterials {
  const texV = createWoodTexture();
  texV.repeat.set(1.5, 4);
  const vertical = new MeshStandardMaterial({
    map: texV,
    roughness: 0.72,
    metalness: 0.02,
    color: 0xffffff,
  });

  const texH = texV.clone();
  texH.rotation = Math.PI / 2;
  texH.center.set(0.5, 0.5);
  texH.needsUpdate = true;
  const horizontal = new MeshStandardMaterial({
    map: texH,
    roughness: 0.72,
    metalness: 0.02,
    color: 0xffffff,
  });

  const cap = new MeshStandardMaterial({
    color: 0xd8b184,
    roughness: 0.85,
    metalness: 0,
    side: 2, // DoubleSide
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return { vertical, horizontal, cap };
}
