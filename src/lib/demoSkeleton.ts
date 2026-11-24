// 演示骨架：程序化装配一具约 215 块骨骼的兽脚类骨架
import type { BoneInstance, ProjectData, Side, Vec3Tuple } from '../types';
import { DEG } from './math3d';

interface BuildCtx {
  bones: BoneInstance[];
  seq: number;
}

function add(
  ctx: BuildCtx,
  templateBaseId: string,
  side: Side,
  parentId: string | null,
  parentSlotId: string | null,
  rotation: Vec3Tuple = [0, 0, 0],
): BoneInstance {
  ctx.seq += 1;
  const b: BoneInstance = {
    id: `${templateBaseId}:${side}#${ctx.seq}`,
    templateBaseId,
    side,
    parentId,
    parentSlotId,
    localPos: [0, 0, 0],
    rotation: [...rotation],
  };
  ctx.bones.push(b);
  return b;
}

export function buildDemoSkeleton(): ProjectData {
  const ctx: BuildCtx = { bones: [], seq: 0 };

  // 荐椎（6 节愈合结构）
  const sacrals: BoneInstance[] = [];
  for (let i = 0; i < 6; i++) {
    const parent = sacrals[i - 1] ?? null;
    sacrals.push(
      add(ctx, 'sacral', 'M', parent ? parent.id : null, parent ? 'next' : null),
    );
  }
  const pelvis = sacrals[0];

  // 背椎（向前，挂在第一荐椎的 next 上反向串联）
  const dorsals: BoneInstance[] = [];
  for (let i = 0; i < 12; i++) {
    const parent = i === 0 ? pelvis : dorsals[i - 1];
    const d = add(ctx, 'dorsal', 'M', parent.id, 'next');
    dorsals.push(d);

    // 每节背椎一对肋骨
    for (const side of ['L', 'R'] as Side[]) {
      const rib = add(
        ctx,
        'rib',
        side,
        d.id,
        side === 'L' ? 'ribL' : 'ribR',
        side === 'L' ? [0, DEG(-8), DEG(-6)] : [0, DEG(-8), DEG(6)],
      );
      // 腹肋（成对）
      add(ctx, 'gastralium', side, rib.id, 'tip', [0, 0, 0]);
    }
  }

  // 颈椎 + 头骨
  const cervicals: BoneInstance[] = [];
  for (let i = 0; i < 8; i++) {
    const parent = i === 0 ? dorsals[11] : cervicals[i - 1];
    const c = add(
      ctx,
      'cervical',
      'M',
      parent.id,
      'next',
      [DEG(8), 0, 0],
    );
    cervicals.push(c);
    for (const side of ['L', 'R'] as Side[]) {
      add(
        ctx,
        'cervicalRib',
        side,
        c.id,
        side === 'L' ? 'ribL' : 'ribR',
        side === 'L' ? [0, 0, DEG(-10)] : [0, 0, DEG(10)],
      );
    }
  }
  const skull = add(ctx, 'skull', 'M', cervicals[7].id, 'next');
  add(ctx, 'mandible', 'M', skull.id, 'jaw', [DEG(-4), 0, 0]);

  // 尾椎（自然下弯弧线，逐节递增，处于关节极限内）
  const caudals: BoneInstance[] = [];
  for (let i = 0; i < 44; i++) {
    const parent = i === 0 ? pelvis : caudals[i - 1];
    const bend = -DEG(Math.min(2.2, 0.4 + i * 0.06));
    const c = add(ctx, 'caudal', 'M', parent.id, 'next', [bend, 0, 0]);
    caudals.push(c);
    if (i < 28 && i % 2 === 1) {
      add(ctx, 'chevron', 'M', c.id, 'chev');
    }
  }

  // ---- 骨盆带与后肢 ----
  for (const side of ['L', 'R'] as Side[]) {
    const ilium = add(
      ctx,
      'ilium',
      side,
      pelvis.id,
      side === 'L' ? 'iliumL' : 'iliumR',
    );
    add(ctx, 'pubis', side, ilium.id, 'pubis');

    const femur = add(
      ctx,
      'femur',
      side,
      ilium.id,
      'hip',
      side === 'L' ? [DEG(18), 0, DEG(-8)] : [DEG(18), 0, DEG(8)],
    );
    const tibia = add(
      ctx,
      'tibia',
      side,
      femur.id,
      'knee',
      side === 'L' ? [DEG(-32), 0, DEG(4)] : [DEG(-32), 0, DEG(-4)],
    );
    const meta = add(ctx, 'metatarsal', side, tibia.id, 'ankle', [DEG(20), 0, 0]);

    // 三趾，每趾 4 节趾骨
    const toeSpreads = [DEG(-12), 0, DEG(12)];
    for (let toe = 0; toe < 3; toe++) {
      let parent = meta;
      let slot = 'toe';
      for (let ph = 0; ph < 4; ph++) {
        const rot: Vec3Tuple =
          side === 'L'
            ? [DEG(-5 - ph * 3), toeSpreads[toe], 0]
            : [DEG(-5 - ph * 3), -toeSpreads[toe], 0];
        const d = add(ctx, 'pedalDigit', side, parent.id, slot, rot);
        parent = d;
        slot = 'next';
      }
    }
  }

  // ---- 肩带与前肢（挂在靠前的背椎上） ----
  for (const side of ['L', 'R'] as Side[]) {
    const scapula = add(
      ctx,
      'scapula',
      side,
      dorsals[8].id,
      side === 'L' ? 'scapulaL' : 'scapulaR',
    );
    const humerus = add(
      ctx,
      'humerus',
      side,
      scapula.id,
      'shoulder',
      side === 'L' ? [DEG(-25), 0, DEG(-6)] : [DEG(-25), 0, DEG(6)],
    );
    const radius = add(ctx, 'radius', side, humerus.id, 'elbow', [DEG(-40), 0, 0]);
    // 两指，每指 3 节
    let digitRoot = radius;
    for (let f = 0; f < 2; f++) {
      let parent = digitRoot;
      let slot = 'wrist';
      for (let ph = 0; ph < 3; ph++) {
        const d = add(
          ctx,
          'manusDigit',
          side,
          parent.id,
          slot,
          side === 'L'
            ? [DEG(-10 - ph * 4), DEG(f === 0 ? -8 : 8), 0]
            : [DEG(-10 - ph * 4), DEG(f === 0 ? 8 : -8), 0],
        );
        parent = d;
        slot = 'next';
      }
    }
  }

  return {
    version: 1,
    bones: ctx.bones,
    rootTransform: { pos: [0, 1.4, 0], rot: [0, 0, 0] },
    settings: {
      groundSnap: false,
      clip: { enabled: false, pos: [0, 0, 0], normal: [1, 0, 0] },
    },
  };
}
