import type { Channel, FlowResult, GatingNode, NodeFlowResult, ChannelFlowResult } from './types';
import { circleArea } from './geometry';

/**
 * 计算浇道网络的流量分配。
 *
 * 规则：
 * - 根节点（浇口杯，无上游）均分总入流 1.0；
 * - 分叉处按下游通道截面积比例分配：q_i = Q * A_i / ΣA；
 * - 内浇口为末端，流量在此进入铸件；
 * - 与网络断开的子图流入为 0。
 *
 * @param imbalanceThreshold 均衡阈值 0..1，分叉比例偏离 1/N 超过该值则标记失衡
 */
export function computeFlow(
  nodes: GatingNode[],
  channels: Channel[],
  imbalanceThreshold: number
): FlowResult {
  const outgoing = new Map<string, Channel[]>();
  const indegree = new Map<string, number>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    nodeIds.add(node.id);
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  const validChannels = channels.filter((c) => nodeIds.has(c.from) && nodeIds.has(c.to));
  for (const channel of validChannels) {
    outgoing.get(channel.from)?.push(channel);
    indegree.set(channel.to, (indegree.get(channel.to) ?? 0) + 1);
  }

  // Kahn 拓扑排序（对环做防御性处理）
  const remaining = new Map(indegree);
  const queue = nodes.filter((n) => (remaining.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const ch of outgoing.get(id) ?? []) {
      const d = (remaining.get(ch.to) ?? 1) - 1;
      remaining.set(ch.to, d);
      if (d === 0) queue.push(ch.to);
    }
  }
  // 环内节点追加到末尾，保证每个节点都有结果
  for (const node of nodes) {
    if (!order.includes(node.id)) order.push(node.id);
  }

  // 根节点即浇口杯（cup）：只有浇口杯能引入外部金属液。
  // 不能只看入度——断开上游后中间节点入度也会归零，但它没有真实入流。
  const rootIds = nodes.filter((n) => n.kind === 'cup').map((n) => n.id);

  const inflow = new Map<string, number>();
  for (const node of nodes) inflow.set(node.id, 0);
  const rootShare = rootIds.length > 0 ? 1 / rootIds.length : 0;
  for (const id of rootIds) inflow.set(id, rootShare);

  const nodeResults: Record<string, NodeFlowResult> = {};
  const channelResults: Record<string, ChannelFlowResult> = {};

  for (const id of order) {
    const q = inflow.get(id) ?? 0;
    const outs = outgoing.get(id) ?? [];
    const areas = outs.map((c) => circleArea(c.diameter));
    const totalArea = areas.reduce((acc, a) => acc + a, 0);

    const outflowByChannel: Record<string, number> = {};
    const splitRatios: Record<string, number> = {};

    outs.forEach((channel, i) => {
      const ratio = totalArea > 0 ? areas[i] / totalArea : 0;
      splitRatios[channel.id] = ratio;
      const share = q * ratio;
      outflowByChannel[channel.id] = share;
      channelResults[channel.id] = {
        channelId: channel.id,
        share,
        area: areas[i],
        velocity: areas[i] > 0 ? share / areas[i] : 0
      };
      inflow.set(channel.to, (inflow.get(channel.to) ?? 0) + share);
    });

    let imbalance = 0;
    if (outs.length >= 2) {
      const ideal = 1 / outs.length;
      const maxDeviation = Math.max(
        ...outs.map((c) => Math.abs((splitRatios[c.id] ?? 0) - ideal))
      );
      // 归一化：均衡时为 0，单管独占时为 1
      imbalance = maxDeviation / (1 - ideal);
    }

    nodeResults[id] = {
      nodeId: id,
      inflow: q,
      outflowByChannel,
      splitRatios,
      imbalance,
      balanced: outs.length >= 2 ? imbalance <= imbalanceThreshold : true,
      downstreamArea: totalArea
    };
  }

  // 断流判定：传播结束后入流仍为 0 的节点。
  // 注意：断开上游后，原中间节点可能入度归零被拓扑排序当作“根”，
  // 但它没有真实入流，因此仍应计入断流，不能用 rootIds 排除。
  const detachedNodeIds = nodes
    .filter((n) => (inflow.get(n.id) ?? 0) <= 1e-12)
    .map((n) => n.id);

  return { nodes: nodeResults, channels: channelResults, rootIds, detachedNodeIds };
}
