import type { ExportFile } from './store.svelte';
import type { Channel, FlowResult, GatingNode, Riser } from './types';
import { circleArea, distance, formatPct } from './geometry';

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function buildJSON(data: ExportFile): string {
  return JSON.stringify(data, null, 2);
}

export function exportJSON(data: ExportFile): void {
  download(`gating-riser-${stamp()}.json`, buildJSON(data), 'application/json');
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(',');
}

/** 生成浇道网络 + 冒口布置 CSV 工程量表文本（带 BOM，Excel 可直接打开中文） */
export function buildCSV(
  nodes: GatingNode[],
  channels: Channel[],
  risers: Riser[],
  flow: FlowResult,
  hotspotName: (id: string | null) => string,
  unbalancedNodeIds: string[] = []
): string {
  const lines: string[] = ['﻿浇道网络与冒口布置工程量表'];
  lines.push(csvRow(['# 浇道通道']));
  lines.push(
    csvRow([
      '通道ID', '起点', '终点', '类型', '层级', '管径mm', '长度mm', '截面积mm²', '流量份额'
    ])
  );
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const c of channels) {
    const a = nodeMap.get(c.from);
    const b = nodeMap.get(c.to);
    const len = a && b ? distance(a.position, b.position) : 0;
    lines.push(
      csvRow([
        c.id,
        c.from,
        c.to,
        c.type,
        `L${c.level}`,
        c.diameter.toFixed(1),
        len.toFixed(1),
        circleArea(c.diameter).toFixed(1),
        formatPct(flow.channels[c.id]?.share ?? 0)
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['# 节点']));
  lines.push(csvRow(['节点ID', '类型', 'X', 'Y', 'Z', '流入比例', '状态']));
  for (const n of nodes) {
    const r = flow.nodes[n.id];
    lines.push(
      csvRow([
        n.id,
        n.kind,
        n.position.x.toFixed(1),
        n.position.y.toFixed(1),
        n.position.z.toFixed(1),
        formatPct(r?.inflow ?? 0),
        r && !r.balanced ? '比例失衡' : '正常'
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['# 冒口（上限8个）']));
  lines.push(csvRow(['冒口ID', 'X', 'Y', 'Z', '直径mm', '高度mm', '最近热节', '连接距离mm']));
  for (const r of risers) {
    lines.push(
      csvRow([
        r.id,
        r.position.x.toFixed(1),
        r.position.y.toFixed(1),
        r.position.z.toFixed(1),
        r.diameter.toFixed(1),
        r.height.toFixed(1),
        hotspotName(r.linkedHotSpotId),
        r.distance === null ? '—' : r.distance.toFixed(1)
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['# 失衡节点', unbalancedNodeIds.join('|')]));
  lines.push(csvRow(['# 未接入节点', flow.detachedNodeIds.join('|')]));
  return lines.join('\n');
}

export function exportCSV(
  nodes: GatingNode[],
  channels: Channel[],
  risers: Riser[],
  flow: FlowResult,
  hotspotName: (id: string | null) => string,
  unbalancedNodeIds: string[] = []
): void {
  const text = buildCSV(nodes, channels, risers, flow, hotspotName, unbalancedNodeIds);
  download(`gating-riser-${stamp()}.csv`, text, 'text/csv;charset=utf-8');
}
