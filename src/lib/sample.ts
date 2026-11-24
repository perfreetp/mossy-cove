import type { CastingConfig, Channel, DesignState, GatingNode, Riser } from './types';
import { uid } from './geometry';

export const DEFAULT_CASTING: CastingConfig = {
  shape: 'box',
  length: 600,
  width: 400,
  height: 300,
  wallThickness: 30
};

function node(kind: GatingNode['kind'], x: number, y: number, z: number): GatingNode {
  return { id: uid('n'), kind, position: { x, y, z } };
}

/** 初始示例：一浇口杯 → 直浇道 → 横浇道两级分叉 → 4 个内浇口 + 2 个冒口 */
export function buildSampleDesign(casting: CastingConfig): {
  state: DesignState;
  casting: CastingConfig;
} {
  const top = casting.height;
  const runnerY = Math.max(60, top * 0.3);
  const runnerZ = -casting.width / 2 - 60;
  const wallZ = -casting.width / 2 + 5;

  const cup = node('cup', -casting.length / 2 + 40, top + 130, runnerZ);
  const sprueBase = node('sprue-base', cup.position.x, runnerY, runnerZ);
  const j1 = node('junction', -70, runnerY, runnerZ);
  const j2 = node('junction', 140, runnerY, runnerZ);
  const i1 = node('ingate', -120, runnerY, wallZ);
  const i2 = node('ingate', -20, runnerY, wallZ);
  const i3 = node('ingate', 100, runnerY, wallZ);
  const i4 = node('ingate', 200, runnerY, wallZ);

  const nodes = [cup, sprueBase, j1, j2, i1, i2, i3, i4];

  const ch = (
    from: GatingNode,
    to: GatingNode,
    type: Channel['type'],
    level: Channel['level'],
    diameter: number
  ): Channel => ({ id: uid('ch'), from: from.id, to: to.id, type, level, diameter });

  const channels: Channel[] = [
    ch(cup, sprueBase, 'downsprue', 1, 28),
    ch(sprueBase, j1, 'runner', 2, 20),
    ch(j1, i1, 'ingate', 3, 12),
    ch(j1, i2, 'ingate', 3, 12),
    ch(j1, j2, 'runner', 2, 20),
    ch(j2, i3, 'ingate', 3, 12),
    ch(j2, i4, 'ingate', 3, 12)
  ];

  const risers: Riser[] = [
    {
      id: uid('r'),
      position: { x: -150, y: top, z: 80 },
      diameter: 70,
      height: 95,
      linkedHotSpotId: null,
      distance: null
    },
    {
      id: uid('r'),
      position: { x: 150, y: top, z: 80 },
      diameter: 70,
      height: 95,
      linkedHotSpotId: null,
      distance: null
    }
  ];

  return { state: { nodes, channels, risers }, casting: { ...casting } };
}
