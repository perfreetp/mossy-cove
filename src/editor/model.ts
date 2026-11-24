import type {
  Brow,
  BrowPoint,
  Density,
  Lash,
  LashRow,
  Point2,
  ProjectDocument,
  Side,
} from './types';
import { otherSide } from './faceGeometry';

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function cloneDocument(doc: ProjectDocument): ProjectDocument {
  return JSON.parse(JSON.stringify(doc)) as ProjectDocument;
}

function makeBrow(side: Side): Brow {
  const s = side === 'right' ? 1 : -1;
  const coords: Array<[number, number, number]> = [
    [0.2, 0.665, 0.052],
    [0.35, 0.79, 0.083],
    [0.52, 0.845, 0.104],
    [0.68, 0.805, 0.092],
    [0.82, 0.715, 0.04],
  ];
  const points: BrowPoint[] = coords.map(([x, y, width], i) => ({
    id: uid(`bp_${side}_${i}`),
    x: x * s,
    y,
    width,
    taper: i === 0 ? 0.22 : i === coords.length - 1 ? 1 : 0,
  }));
  return {
    id: side,
    points,
    segmentMirror: points.slice(0, -1).map(() => true),
    density: 'natural',
    color: '#3a2418',
  };
}

export function makeLash(partial: Partial<Lash> & Pick<Lash, 'side' | 't'>): Lash {
  return {
    id: uid('lash'),
    length: 9.5,
    curl: 38,
    thickness: 3,
    rowId: null,
    ...partial,
  };
}

function makeStarterLashes(): Lash[] {
  const result: Lash[] = [];
  (['left', 'right'] as Side[]).forEach((side) => {
    for (let i = 0; i < 23; i++) {
      const t = 0.07 + (0.88 * i) / 22;
      const arch = Math.sin(Math.PI * t);
      result.push(
        makeLash({
          side,
          t,
          length: 7.6 + 4.7 * arch + 1.4 * t,
          curl: 27 + 24 * arch,
          thickness: 2.2 + 1.3 * arch,
        }),
      );
    }
  });
  return result;
}

export function createDefaultDocument(): ProjectDocument {
  return {
    format: 'brow-lash-studio',
    version: 1,
    mirror: true,
    brows: {
      left: makeBrow('left'),
      right: makeBrow('right'),
    },
    lashes: makeStarterLashes(),
    rows: [],
  };
}

function isPointMirrorLinked(brow: Brow, index: number): boolean {
  if (brow.points.length <= 1) return false;
  const links = brow.segmentMirror;
  if (index === 0) return links[0] !== false;
  if (index === brow.points.length - 1) return links[links.length - 1] !== false;
  // A point belongs to both neighboring intervals, so either interval being
  // explicitly independent makes this boundary point single-side controlled.
  return links[index - 1] !== false && links[index] !== false;
}

/** Copy linked spans from the edited brow to its mirrored counterpart. */
export function syncBrowMirror(doc: ProjectDocument, source: Side): void {
  if (!doc.mirror) return;
  const a = doc.brows[source];
  const b = doc.brows[otherSide(source)];
  if (!a || !b) return;

  b.density = a.density;
  b.color = a.color;

  if (a.points.length < 2) {
    b.points = [];
    b.segmentMirror = [];
    return;
  }

  if (b.points.length !== a.points.length) {
    b.points = a.points.map((p, i) => ({
      ...p,
      id: uid(`bp_mirror_${i}`),
      x: -p.x,
    }));
    b.segmentMirror = [...a.segmentMirror];
    return;
  }

  a.points.forEach((p, i) => {
    if (isPointMirrorLinked(a, i)) {
      const target = b.points[i];
      target.x = -p.x;
      target.y = p.y;
      target.width = p.width;
      target.taper = p.taper;
    }
  });

  for (let i = 0; i < a.segmentMirror.length; i++) {
    b.segmentMirror[i] = a.segmentMirror[i] !== false;
  }
  if (b.segmentMirror.length !== a.segmentMirror.length) {
    b.segmentMirror = [...a.segmentMirror];
  }
}

/** Any handle edit unlinks the adjacent interval(s), implementing segment-level release. */
export function breakPointMirror(doc: ProjectDocument, side: Side, pointId: string): void {
  const brow = doc.brows[side];
  const index = brow.points.findIndex((p) => p.id === pointId);
  if (index < 0) return;
  [side, otherSide(side)].forEach((sd) => {
    const bb = doc.brows[sd];
    if (index > 0 && bb.segmentMirror[index - 1] !== undefined) {
      bb.segmentMirror[index - 1] = false;
    }
    if (index < bb.segmentMirror.length && bb.segmentMirror[index] !== undefined) {
      bb.segmentMirror[index] = false;
    }
  });
}

export function setSegmentMirror(
  doc: ProjectDocument,
  side: Side,
  segmentIndex: number,
  linked: boolean,
): void {
  const brow = doc.brows[side];
  if (segmentIndex < 0 || segmentIndex >= brow.segmentMirror.length) return;
  brow.segmentMirror[segmentIndex] = linked;
  doc.brows[otherSide(side)].segmentMirror[segmentIndex] = linked;
  if (linked) syncBrowMirror(doc, side);
}

function resampleStroke(raw: Point2[], count = 6): Point2[] {
  if (raw.length === 0) return [];
  if (raw.length === 1) return [raw[0], raw[0]];

  const distances = [0];
  let total = 0;
  for (let i = 1; i < raw.length; i++) {
    total += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    distances.push(total);
  }
  if (total < 0.08) return [];

  const result: Point2[] = [];
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    let i = 1;
    while (i < distances.length - 1 && distances[i] < target) i++;
    const d0 = distances[i - 1];
    const d1 = distances[i];
    const f = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    result.push({
      x: raw[i - 1].x + (raw[i].x - raw[i - 1].x) * f,
      y: raw[i - 1].y + (raw[i].y - raw[i - 1].y) * f,
    });
  }
  return result;
}

export function replaceBrowFromStroke(
  doc: ProjectDocument,
  side: Side,
  raw: Point2[],
): boolean {
  let sampled = resampleStroke(raw, 6);
  if (sampled.length < 2) return false;

  // Store inner-corner first, outer-temple last.
  if (Math.abs(sampled[0].x) > Math.abs(sampled[sampled.length - 1].x)) {
    sampled = sampled.reverse();
  }

  const widthProfile = [0.055, 0.087, 0.108, 0.1, 0.078, 0.038];
  const points: BrowPoint[] = sampled.map((p, i) => ({
    id: uid(`bp_${side}`),
    x: p.x,
    y: p.y,
    width: widthProfile[i] ?? 0.07,
    taper: i === 0 ? 0.2 : i === sampled.length - 1 ? 1 : 0,
  }));

  doc.brows[side].points = points;
  doc.brows[side].segmentMirror = points.slice(0, -1).map(() => true);
  if (doc.mirror) {
    doc.brows[otherSide(side)].points = points.map((p, i) => ({
      ...p,
      id: uid(`bp_mirror_${i}`),
      x: -p.x,
    }));
    doc.brows[otherSide(side)].segmentMirror = points.slice(0, -1).map(() => true);
  }
  return true;
}

export function eraseBrow(doc: ProjectDocument, side: Side): void {
  doc.brows[side].points = [];
  doc.brows[side].segmentMirror = [];
  // Keep the erased side erased until the user explicitly re-enables mirroring.
  doc.mirror = false;
}

export function duplicateLashAsRow(
  doc: ProjectDocument,
  lashId: string,
  count = 9,
): string | null {
  const source = doc.lashes.find((l) => l.id === lashId);
  if (!source) return null;
  const row: LashRow = {
    id: uid('row'),
    side: source.side,
    name: `扇形排 ${doc.rows.length + 1}`,
    rotation: 0,
    lift: 0,
  };
  doc.rows.push(row);
  source.rowId = row.id;

  const spacing = 0.045;
  const start = source.t - ((count - 1) * spacing) / 2;
  const created: Lash[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.min(0.985, Math.max(0.015, start + i * spacing));
    if (Math.abs(t - source.t) < spacing * 0.45) continue;
    created.push({
      ...source,
      id: uid('lash'),
      t,
      rowId: row.id,
    });
  }
  doc.lashes.push(...created);
  return row.id;
}

export function duplicateRow(doc: ProjectDocument, rowId: string): string | null {
  const row = doc.rows.find((r) => r.id === rowId);
  if (!row) return null;
  const lashes = doc.lashes.filter((l) => l.rowId === rowId);
  const newRow: LashRow = {
    ...row,
    id: uid('row'),
    name: `${row.name} 副本`,
    lift: row.lift + 0.035,
    rotation: row.rotation + 8,
  };
  doc.rows.push(newRow);
  doc.lashes.push(
    ...lashes.map((l) => ({ ...l, id: uid('lash'), rowId: newRow.id })),
  );
  return newRow.id;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generates several batched rows, comfortably exceeding several hundred lashes. */
export function fillPerformanceLashes(doc: ProjectDocument, perSide = 240): void {
  doc.lashes = [];
  doc.rows = [];
  const random = mulberry32(20261125);
  (['left', 'right'] as Side[]).forEach((side) => {
    const rowCount = 6;
    const perRow = Math.floor(perSide / rowCount);
    for (let r = 0; r < rowCount; r++) {
      const row: LashRow = {
        id: uid('perfrow'),
        side,
        name: `浓密排 ${side === 'left' ? '左' : '右'} ${r + 1}`,
        rotation: (r - (rowCount - 1) / 2) * 7,
        lift: r * 0.026,
      };
      doc.rows.push(row);
      for (let i = 0; i < perRow; i++) {
        const t = 0.035 + (0.93 * (i + 0.5)) / perRow + (random() - 0.5) * 0.012;
        const arch = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
        doc.lashes.push(
          makeLash({
            side,
            t,
            length: 7.5 + 5.2 * arch + random() * 1.8 - r * 0.35,
            curl: 24 + 28 * arch + random() * 10,
            thickness: 2 + random() * 1.8,
            rowId: row.id,
          }),
        );
      }
    }
  });
}

function asSide(value: unknown, fallback: Side): Side {
  return value === 'left' || value === 'right' ? value : fallback;
}

function normalizeBrow(raw: unknown, side: Side): Brow {
  const fallback = makeBrow(side);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<Brow>;
  const points = Array.isArray(r.points)
    ? r.points
        .filter((p): p is BrowPoint => !!p && typeof p.x === 'number' && typeof p.y === 'number')
        .map((p, i) => ({
          id: typeof p.id === 'string' ? p.id : uid(`bp_${side}_${i}`),
          x: p.x,
          y: p.y,
          width: typeof p.width === 'number' ? p.width : 0.075,
          taper: typeof p.taper === 'number' ? p.taper : i === 0 ? 0.2 : i === (r.points?.length ?? 1) - 1 ? 1 : 0,
        }))
    : fallback.points;
  return {
    id: side,
    points,
    segmentMirror:
      Array.isArray(r.segmentMirror) && r.segmentMirror.length === Math.max(0, points.length - 1)
        ? r.segmentMirror.map(Boolean)
        : points.slice(0, -1).map(() => true),
    density:
      r.density === 'sparse' || r.density === 'natural' || r.density === 'dense'
        ? (r.density as Density)
        : 'natural',
    color: typeof r.color === 'string' ? r.color : '#3a2418',
  };
}

export function normalizeDocument(raw: unknown): ProjectDocument {
  const envelope =
    raw && typeof raw === 'object' && 'doc' in raw
      ? (raw as { doc: unknown }).doc
      : raw;
  const fallback = createDefaultDocument();
  if (!envelope || typeof envelope !== 'object') return fallback;
  const r = envelope as Partial<ProjectDocument>;

  const rows: LashRow[] = Array.isArray(r.rows)
    ? r.rows
        .filter((row): row is LashRow => !!row && typeof row.id === 'string')
        .map((row) => ({
          id: row.id,
          side: asSide(row.side, 'right'),
          name: typeof row.name === 'string' ? row.name : '睫毛排',
          rotation: typeof row.rotation === 'number' ? row.rotation : 0,
          lift: typeof row.lift === 'number' ? row.lift : 0,
        }))
    : [];

  const lashes: Lash[] = Array.isArray(r.lashes)
    ? r.lashes
        .filter((l): l is Lash => !!l && typeof l.id === 'string')
        .map((l) => ({
          id: l.id,
          side: asSide(l.side, 'right'),
          t: typeof l.t === 'number' ? Math.min(1, Math.max(0, l.t)) : 0.5,
          length: typeof l.length === 'number' ? l.length : 9,
          curl: typeof l.curl === 'number' ? l.curl : 38,
          thickness: typeof l.thickness === 'number' ? l.thickness : 3,
          rowId: typeof l.rowId === 'string' ? l.rowId : null,
        }))
    : fallback.lashes;

  return {
    format: 'brow-lash-studio',
    version: 1,
    mirror: typeof r.mirror === 'boolean' ? r.mirror : true,
    brows: {
      left: normalizeBrow(r.brows?.left, 'left'),
      right: normalizeBrow(r.brows?.right, 'right'),
    },
    lashes,
    rows,
  };
}
