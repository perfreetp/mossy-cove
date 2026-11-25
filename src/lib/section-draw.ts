// 截面 2D 绘制与导出:网格缩略图、大图预览、PNG、轮廓坐标文件
import type { SectionResult, ContourData } from './types';

export interface DrawOptions {
  width: number;
  height: number;
  fillColor: string;
  lineColor: string;
  holeFillColor?: string;
  background?: string;
  showGrid?: boolean;
  title?: string;
  /** 世界坐标比例尺标注 */
  showScale?: boolean;
}

interface Transform2D {
  scale: number;
  ox: number;
  oy: number;
}

function computeTransform(result: SectionResult, w: number, h: number, pad = 14): Transform2D {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of result.contours) {
    for (const [x, y] of c.points2d) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (!isFinite(minX)) return { scale: 1, ox: w / 2, oy: h / 2 };
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * scale) / 2 - minX * scale;
  // 画布 y 向下,翻转
  const oy = (h - spanY * scale) / 2 + maxY * scale;
  return { scale, ox, oy };
}

function tracePath(ctx: CanvasRenderingContext2D, c: ContourData, t: Transform2D) {
  ctx.beginPath();
  c.points2d.forEach(([x, y], i) => {
    const px = t.ox + x * t.scale;
    const py = t.oy - y * t.scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

export function drawSection(canvas: HTMLCanvasElement, result: SectionResult, opts: DrawOptions) {
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d')!;
  const bg = opts.background ?? '#10141b';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, opts.width, opts.height);

  if (opts.showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const step = opts.width / 12;
    for (let x = step; x < opts.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, opts.height); ctx.stroke();
    }
    for (let y = step; y < opts.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(opts.width, y); ctx.stroke();
    }
  }

  const t = computeTransform(result, opts.width, opts.height);
  if (!result.contours.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('该位置无截面', opts.width / 2, opts.height / 2);
    return t;
  }

  // 填充:先整体外轮廓色,再用孔色覆盖孔洞
  for (const c of result.contours) {
    if (c.isHole) continue;
    tracePath(ctx, c, t);
    ctx.fillStyle = opts.fillColor;
    ctx.fill();
  }
  if (opts.holeFillColor) {
    for (const c of result.contours) {
      if (!c.isHole) continue;
      tracePath(ctx, c, t);
      ctx.fillStyle = opts.holeFillColor;
      ctx.fill();
    }
  }
  // 闭合轮廓线
  ctx.strokeStyle = opts.lineColor;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  for (const c of result.contours) {
    tracePath(ctx, c, t);
    ctx.stroke();
  }

  if (opts.title) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, 10, 20);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`面积 ${result.totalArea.toFixed(4)}`, 10, 38);
  }
  return t;
}

/** 导出当前截面为 PNG dataURL */
export function sectionToPng(result: SectionResult, fillColor: string, lineColor: string, size = 1024): string {
  const canvas = document.createElement('canvas');
  drawSection(canvas, result, {
    width: size,
    height: size,
    fillColor,
    lineColor,
    holeFillColor: '#10141b',
    background: '#ffffff',
    showGrid: false,
    title: undefined
  });
  return canvas.toDataURL('image/png');
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

export function downloadBlob(content: BlobPart, fileName: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 轮廓点坐标导出:JSON(含 2D/3D 点、面积、基向量)与简易 TXT 两种 */
export function contoursToJson(result: SectionResult, planeName: string): string {
  return JSON.stringify({
    plane: planeName,
    point: result.point,
    normal: result.normal,
    basis: result.basis,
    totalArea: result.totalArea,
    contourCount: result.contours.length,
    contours: result.contours.map((c, i) => ({
      index: i,
      isHole: c.isHole,
      signedArea: c.signedArea,
      area: c.area,
      pointCount: c.points2d.length,
      points2d: c.points2d,
      points3d: c.points3d
    }))
  }, null, 2);
}

export function contoursToTxt(result: SectionResult, planeName: string): string {
  const lines: string[] = [];
  lines.push(`# 化石截面轮廓点坐标  平面:${planeName}`);
  lines.push(`# 平面点:${result.point.join(', ')} 法向:${result.normal.join(', ')}`);
  lines.push(`# 总面积:${result.totalArea.toFixed(6)} 轮廓数:${result.contours.length}`);
  result.contours.forEach((c, ci) => {
    lines.push(`# 轮廓 ${ci} ${c.isHole ? '(孔)' : '(外)'} 面积=${c.area.toFixed(6)} 点数=${c.points2d.length}`);
    c.points2d.forEach((p2, i) => {
      const p3 = c.points3d[i];
      lines.push(`${ci}\t${i}\t${p2[0].toFixed(6)}\t${p2[1].toFixed(6)}\t${p3[0].toFixed(6)}\t${p3[1].toFixed(6)}\t${p3[2].toFixed(6)}`);
    });
  });
  return lines.join('\n');
}
