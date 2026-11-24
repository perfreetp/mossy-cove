import { putCloud } from './db';
import { uid } from './util';

/**
 * 合成点云生成器：在浏览器内生成一套 PotreeConverter 2.x 兼容数据
 * （metadata.json + hierarchy.bin + octree.bin），直接写入本地数据仓，
 * 让工具在没有真实扫描数据时也能完整演示全部功能。
 *
 * 场景内容（模拟一个 20m x 16m 的房间）：
 * - 地面、四面墙（带门洞）、天花板的密集点
 * - 桌、柜、床等家具块
 * - 两处「血迹」红色点簇与一把「刀」形点簇，便于练习证据标记
 *
 * 坐标编码（与 potree-core worker 解码对应）：
 *   world = int32 * scale + offset
 * 属性布局：POSITION_CARTESIAN(int32x3) + RGBA(uint16x3)，每点 18 字节。
 */

const ROOM_W = 20; // X
const ROOM_D = 16; // Z
const ROOM_H = 3.2; // Y
const SCALE = 0.001;

interface ColoredPoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pushBox(
  pts: ColoredPoint[],
  rand: () => number,
  min: [number, number, number],
  max: [number, number, number],
  color: [number, number, number],
  count: number,
  jitter = 0.02
): void {
  for (let i = 0; i < count; i++) {
    pts.push({
      x: min[0] + rand() * (max[0] - min[0]) + (rand() - 0.5) * jitter,
      y: min[1] + rand() * (max[1] - min[1]) + (rand() - 0.5) * jitter,
      z: min[2] + rand() * (max[2] - min[2]) + (rand() - 0.5) * jitter,
      r: color[0],
      g: color[1],
      b: color[2]
    });
  }
}

/** 只在盒子表面撒点（墙体/家具外壳更省点且视觉正确） */
function pushBoxSurface(
  pts: ColoredPoint[],
  rand: () => number,
  min: [number, number, number],
  max: [number, number, number],
  color: [number, number, number],
  count: number
): void {
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const areas = [sx * sz, sx * sz, sx * sy, sx * sy, sy * sz, sy * sz];
  const total = areas.reduce((a, b) => a + b, 0);
  for (let i = 0; i < count; i++) {
    let face = 0;
    let pick = rand() * total;
    while (pick > areas[face]) {
      pick -= areas[face];
      face++;
    }
    let x = min[0] + rand() * sx;
    let y = min[1] + rand() * sy;
    let z = min[2] + rand() * sz;
    if (face === 0) y = min[1];
    else if (face === 1) y = max[1];
    else if (face === 2) x = min[0];
    else if (face === 3) x = max[0];
    else if (face === 4) z = min[2];
    else z = max[2];
    pts.push({ x, y, z, r: color[0], g: color[1], b: color[2] });
  }
}

export function generateScenePoints(targetCount: number): ColoredPoint[] {
  const rand = rng(20261125);
  const pts: ColoredPoint[] = [];

  // 按目标规模分配密度
  const density = targetCount / 220000;
  const n = (base: number) => Math.max(200, Math.round(base * density));

  const wallColor: [number, number, number] = [214, 208, 196];
  const floorColor: [number, number, number] = [120, 96, 72];
  const ceilColor: [number, number, number] = [232, 230, 224];

  // 地面与天花板
  pushBox(pts, rand, [-ROOM_W / 2, -0.02, -ROOM_D / 2], [ROOM_W / 2, 0.02, ROOM_D / 2], floorColor, n(60000));
  pushBox(pts, rand, [-ROOM_W / 2, ROOM_H - 0.02, -ROOM_D / 2], [ROOM_W / 2, ROOM_H + 0.02, ROOM_D / 2], ceilColor, n(30000));

  // 四面墙（厚度 0.15），南墙留 1.4m 门洞
  const t = 0.15;
  pushBox(pts, rand, [-ROOM_W / 2, 0, -ROOM_D / 2], [ROOM_W / 2, ROOM_H, -ROOM_D / 2 + t], wallColor, n(25000)); // 北墙
  // 南墙（门洞 x: -0.7~0.7）
  pushBox(pts, rand, [-ROOM_W / 2, 0, ROOM_D / 2 - t], [-0.7, ROOM_H, ROOM_D / 2], wallColor, n(11000));
  pushBox(pts, rand, [0.7, 0, ROOM_D / 2 - t], [ROOM_W / 2, ROOM_H, ROOM_D / 2], wallColor, n(11000));
  pushBox(pts, rand, [-0.7, 2.1, ROOM_D / 2 - t], [0.7, ROOM_H, ROOM_D / 2], wallColor, n(2500)); // 门楣
  // 东西墙
  pushBox(pts, rand, [-ROOM_W / 2, 0, -ROOM_D / 2], [-ROOM_W / 2 + t, ROOM_H, ROOM_D / 2], wallColor, n(20000));
  pushBox(pts, rand, [ROOM_W / 2 - t, 0, -ROOM_D / 2], [ROOM_W / 2, ROOM_H, ROOM_D / 2], wallColor, n(20000));

  // 家具：桌子（桌面 + 四腿）
  pushBoxSurface(pts, rand, [2.2, 0.75, -4.5], [5.2, 0.85, -2.2], [139, 94, 52], n(9000));
  for (const [lx, lz] of [
    [2.35, -4.35],
    [5.05, -4.35],
    [2.35, -2.35],
    [5.05, -2.35]
  ]) {
    pushBox(pts, rand, [lx, 0, lz], [lx + 0.12, 0.75, lz + 0.12], [96, 64, 36], n(900));
  }

  // 柜子
  pushBoxSurface(pts, rand, [-8.5, 0, -6.5], [-6.2, 2.0, -3.5], [88, 104, 120], n(12000));

  // 床
  pushBoxSurface(pts, rand, [-8.2, 0, 2.5], [-3.0, 0.55, 6.8], [70, 86, 110], n(14000));
  pushBox(pts, rand, [-8.2, 0.55, 5.8], [-5.8, 0.72, 6.8], [240, 240, 245], n(3000)); // 枕头

  // 书架
  pushBoxSurface(pts, rand, [6.8, 0, -7], [9.2, 2.2, -5.4], [110, 76, 44], n(8000));
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.5 + shelf * 0.6;
    pushBox(pts, rand, [6.85, y, -6.95], [9.15, y + 0.06, -5.45], [120, 84, 50], n(1200));
  }

  // 证据物 1：桌面血迹（红色点簇，带溅射）
  for (let i = 0; i < n(2600); i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 2.2) * 0.55;
    pts.push({
      x: 3.7 + Math.cos(angle) * r,
      y: 0.86 + rand() * 0.01,
      z: -3.35 + Math.sin(angle) * r * 0.7,
      r: 160 + Math.round(rand() * 60),
      g: 18,
      b: 18
    });
  }
  // 地面滴落血迹
  for (let i = 0; i < n(900); i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 2) * 0.35;
    pts.push({
      x: 3.4 + Math.cos(angle) * r,
      y: 0.03,
      z: -1.6 + Math.sin(angle) * r,
      r: 140 + Math.round(rand() * 50),
      g: 14,
      b: 14
    });
  }

  // 证据物 2：地面上的刀（细长刀身 + 刀柄）
  for (let i = 0; i < n(1400); i++) {
    const along = rand();
    const isHandle = along > 0.78;
    pts.push({
      x: -2.2 + along * 1.1,
      y: 0.05 + rand() * 0.02,
      z: 1.2 + (rand() - 0.5) * (isHandle ? 0.14 : 0.06),
      r: isHandle ? 60 : 200,
      g: isHandle ? 42 : 205,
      b: isHandle ? 28 : 210
    });
  }

  // 证据物 3：破碎玻璃痕迹（青色亮点）
  for (let i = 0; i < n(1800); i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 1.8) * 0.8;
    pts.push({
      x: 6.4 + Math.cos(angle) * r,
      y: 0.04,
      z: 2.6 + Math.sin(angle) * r,
      r: 150,
      g: 220,
      b: 235
    });
  }

  // 室内随机噪点（模拟扫描噪声）
  for (let i = 0; i < n(4000); i++) {
    pts.push({
      x: -ROOM_W / 2 + rand() * ROOM_W,
      y: rand() * ROOM_H,
      z: -ROOM_D / 2 + rand() * ROOM_D,
      r: 180 + Math.round(rand() * 40),
      g: 180 + Math.round(rand() * 40),
      b: 175 + Math.round(rand() * 40)
    });
  }

  return pts;
}

/**
 * 生成并写入本地数据仓。
 * @param targetCount 目标点数（默认 25 万，可演示千万级时调高）
 */
export async function generateAndStoreCloud(
  targetCount = 250000
): Promise<{ key: string; name: string; points: number }> {
  const points = generateScenePoints(targetCount);

  const min: [number, number, number] = [-ROOM_W / 2 - 0.3, -0.1, -ROOM_D / 2 - 0.3];
  const max: [number, number, number] = [ROOM_W / 2 + 0.3, ROOM_H + 0.3, ROOM_D / 2 + 0.3];
  const offset: [number, number, number] = [min[0], min[1], min[2]];
  const scale: [number, number, number] = [SCALE, SCALE, SCALE];

  // ---- octree.bin：POSITION_CARTESIAN int32*3 + RGBA uint16*3 = 18 字节/点 ----
  // potree-core 2.x 解码（loader 已把节点 boundingBox 平移为相对坐标，根节点 min=0）：
  //   world = int32 * scale + globalOffset - nodeBoxMin(=0)
  // 因此存储 (world - globalOffset) / scale，globalOffset 取场景全局 min。
  const BYTE_SIZE = 18;
  const bin = new ArrayBuffer(points.length * BYTE_SIZE);
  const view = new DataView(bin);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const base = i * BYTE_SIZE;
    view.setInt32(base + 0, Math.round((p.x - offset[0]) / SCALE), true);
    view.setInt32(base + 4, Math.round((p.y - offset[1]) / SCALE), true);
    view.setInt32(base + 8, Math.round((p.z - offset[2]) / SCALE), true);
    view.setUint16(base + 12, Math.min(65535, p.r * 257), true);
    view.setUint16(base + 14, Math.min(65535, p.g * 257), true);
    view.setUint16(base + 16, Math.min(65535, p.b * 257), true);
  }

  // ---- hierarchy.bin：单条 22 字节根记录 ----
  // [type=0(NORMAL), childMask=0, numPoints uint32, byteOffset int64, byteSize int64]
  const hier = new ArrayBuffer(22);
  const hv = new DataView(hier);
  hv.setUint8(0, 0);
  hv.setUint8(1, 0);
  hv.setUint32(2, points.length, true);
  hv.setBigInt64(6, BigInt(0), true);
  hv.setBigInt64(14, BigInt(bin.byteLength), true);

  const metadata = {
    version: '2.0',
    name: '合成案发现场',
    description: '浏览器内生成的 Potree 2.x 兼容模拟现场',
    points: points.length,
    projection: '',
    hierarchy: {
      firstChunkSize: 22,
      stepSize: 1,
      depth: 0
    },
    offset,
    scale,
    spacing: 0.02,
    boundingBox: { min, max },
    encoding: 'DEFAULT',
    attributes: [
      {
        // potree-core 渲染管线按小写 position 识别坐标（worker 解码后映射到 three position 属性）
        name: 'position',
        description: '',
        size: 12,
        numElements: 3,
        elementSize: 4,
        type: 'int32',
        min: [0, 0, 0],
        max: [
          Math.round((max[0] - min[0]) / SCALE),
          Math.round((max[1] - min[1]) / SCALE),
          Math.round((max[2] - min[2]) / SCALE)
        ]
      },
      {
        // 小写 rgba：parseAttributes 会将 rgb 映射为 rgba，颜色管线按此键取值
        name: 'rgba',
        description: '',
        size: 6,
        numElements: 3,
        elementSize: 2,
        type: 'uint16',
        min: [0, 0, 0],
        max: [65535, 65535, 65535]
      }
    ]
  };

  const key = uid('cloud');
  const name = `合成案发现场（${(points.length / 10000).toFixed(1)} 万点）`;
  await putCloud(key, name, {
    'metadata.json': new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }),
    'hierarchy.bin': new Blob([hier]),
    'octree.bin': new Blob([bin])
  });

  return { key, name, points: points.length };
}
