import type {
  CastingConfig,
  Channel,
  DesignState,
  GatingNode,
  ModuleId,
  NodeKind,
  Riser,
  Vec3
} from './types';
import { RISER_LIMIT } from './types';
import { clamp, deepClone, distance, uid } from './geometry';
import { computeFlow } from './flow';
import { HistoryStack } from './history';
import { DIAMETER_MAX, DIAMETER_MIN, LEVEL_META, inferChannel } from './meta';
import { buildHotspots, linkRiserToHotspot } from './casting';
import { DEFAULT_CASTING, buildSampleDesign } from './sample';

export type ToolMode = 'select' | 'add-node' | 'connect' | 'add-riser';

export interface ExportFile {
  format: 'gating-riser-design';
  version: 1;
  exportedAt: string;
  casting: CastingConfig;
  gating: {
    nodes: GatingNode[];
    channels: Channel[];
  };
  risers: Riser[];
  flowSummary: {
    imbalanceThreshold: number;
    unbalancedNodeIds: string[];
    detachedNodeIds: string[];
  };
}

class DesignStore {
  nodes = $state<GatingNode[]>([]);
  channels = $state<Channel[]>([]);
  risers = $state<Riser[]>([]);
  casting = $state<CastingConfig>({ ...DEFAULT_CASTING });
  hotspots = $state<import('./types').HotSpot[]>([]);

  module = $state<ModuleId>('draw');
  mode = $state<ToolMode>('select');
  pendingNodeKind = $state<NodeKind>('junction');
  snapEnabled = $state(true);
  imbalanceThreshold = $state(0.15);

  selectedNodeId = $state<string | null>(null);
  selectedChannelId = $state<string | null>(null);
  selectedRiserId = $state<string | null>(null);
  /** 连线模式下已选的起点 */
  connectSourceId = $state<string | null>(null);

  canUndo = $state(false);
  canRedo = $state(false);
  lastAction = $state<string | null>(null);
  toast = $state<string | null>(null);
  riserLimitReached = $derived(this.risers.length >= RISER_LIMIT);

  flow = $derived(computeFlow(this.nodes, this.channels, this.imbalanceThreshold));
  unbalancedNodeIds = $derived(
    this.nodes
      .filter((n) => {
        const r = this.flow.nodes[n.id];
        return r && !r.balanced && Object.keys(r.splitRatios).length >= 2;
      })
      .map((n) => n.id)
  );

  private history = new HistoryStack();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.resetSample();
  }

  // ---------- 工具方法 ----------
  nodeById(id: string | null): GatingNode | undefined {
    return id ? this.nodes.find((n) => n.id === id) : undefined;
  }

  channelById(id: string | null): Channel | undefined {
    return id ? this.channels.find((c) => c.id === id) : undefined;
  }

  riserById(id: string | null): Riser | undefined {
    return id ? this.risers.find((r) => r.id === id) : undefined;
  }

  get selectedNode() {
    return this.nodeById(this.selectedNodeId);
  }

  get selectedChannel() {
    return this.channelById(this.selectedChannelId);
  }

  get selectedRiser() {
    return this.riserById(this.selectedRiserId);
  }

  private snapshotState(): DesignState {
    return {
      nodes: deepClone(this.nodes),
      channels: deepClone(this.channels),
      risers: deepClone(this.risers)
    };
  }

  /** 变更前调用（按钮类操作内部调用；拖拽开始时调用一次即可） */
  snapshot(label: string): void {
    this.history.push(label, this.snapshotState());
    this.refreshHistoryFlags();
  }

  private refreshHistoryFlags(): void {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
  }

  private applyState(state: DesignState): void {
    this.nodes = deepClone(state.nodes);
    this.channels = deepClone(state.channels);
    this.risers = deepClone(state.risers);
    this.selectedNodeId = null;
    this.selectedChannelId = null;
    this.selectedRiserId = null;
  }

  showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
    }, 2600);
  }

  setModule(mod: ModuleId): void {
    this.module = mod;
    if (mod === 'draw' && this.mode === 'select') this.mode = 'select';
    if (mod !== 'draw' && this.mode !== 'select' && this.mode !== 'add-riser') {
      this.mode = 'select';
    }
    this.connectSourceId = null;
  }

  setMode(mode: ToolMode): void {
    this.mode = mode;
    if (mode !== 'connect') this.connectSourceId = null;
  }

  selectNode(id: string | null): void {
    this.selectedNodeId = id;
    if (id) {
      this.selectedChannelId = null;
      this.selectedRiserId = null;
    }
  }

  selectChannel(id: string | null): void {
    this.selectedChannelId = id;
    if (id) {
      this.selectedNodeId = null;
      this.selectedRiserId = null;
    }
  }

  selectRiser(id: string | null): void {
    this.selectedRiserId = id;
    if (id) {
      this.selectedNodeId = null;
      this.selectedChannelId = null;
    }
  }

  clearSelection(): void {
    this.selectedNodeId = null;
    this.selectedChannelId = null;
    this.selectedRiserId = null;
    this.connectSourceId = null;
  }

  // ---------- 撤销 / 重做 ----------
  undo(): void {
    const result = this.history.undo(this.snapshotState());
    if (!result) return;
    this.applyState(result.state);
    this.lastAction = `撤销：${result.label}`;
    this.refreshHistoryFlags();
  }

  redo(): void {
    const result = this.history.redo(this.snapshotState());
    if (!result) return;
    this.applyState(result.state);
    this.lastAction = `重做：${result.label}`;
    this.refreshHistoryFlags();
  }

  // ---------- 节点 ----------
  addNode(kind: NodeKind, position: Vec3): GatingNode {
    this.snapshot(`添加${kindLabel(kind)}`);
    const node: GatingNode = { id: uid('n'), kind, position: { ...position } };
    this.nodes.push(node);
    this.selectNode(node.id);
    this.lastAction = `添加节点 ${node.id}`;
    return node;
  }

  deleteNode(id: string): void {
    const node = this.nodeById(id);
    if (!node) return;
    this.snapshot(`删除${kindLabel(node.kind)}`);
    this.channels = this.channels.filter((c) => c.from !== id && c.to !== id);
    this.nodes = this.nodes.filter((n) => n.id !== id);
    if (this.selectedNodeId === id) this.selectedNodeId = null;
    if (this.connectSourceId === id) this.connectSourceId = null;
    this.lastAction = `删除节点 ${id}`;
  }

  moveNode(id: string, position: Vec3): void {
    const node = this.nodeById(id);
    if (node) node.position = { ...position };
  }

  // ---------- 通道（连线 / 断开 / 重连） ----------
  addChannel(fromId: string, toId: string): Channel | null {
    if (fromId === toId) {
      this.showToast('不能连接节点自身');
      return null;
    }
    const exists = this.channels.some(
      (c) =>
        (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
    );
    if (exists) {
      this.showToast('两节点之间已存在浇道');
      return null;
    }
    const from = this.nodeById(fromId);
    const to = this.nodeById(toId);
    if (!from || !to) return null;
    this.snapshot('连接浇道');
    const inferred = inferChannel(from.kind, to.kind);
    const channel: Channel = {
      id: uid('ch'),
      from: fromId,
      to: toId,
      type: inferred.type,
      level: inferred.level,
      diameter: LEVEL_META[inferred.level].defaultDiameter
    };
    this.channels.push(channel);
    this.lastAction = `连接 ${fromId} → ${toId}`;
    return channel;
  }

  /** 断开：删除通道，下游流量归零并在下次 flow 派生时重新分配 */
  disconnectChannel(id: string): void {
    const channel = this.channelById(id);
    if (!channel) return;
    this.snapshot('断开浇道');
    this.channels = this.channels.filter((c) => c.id !== id);
    if (this.selectedChannelId === id) this.selectedChannelId = null;
    this.lastAction = `断开浇道 ${id}`;
  }

  /** 断开重连：保持管径不变，改接端点 */
  reconnectChannel(id: string, endpoint: 'from' | 'to', newNodeId: string): void {
    const channel = this.channelById(id);
    if (!channel) return;
    const other = endpoint === 'from' ? channel.to : channel.from;
    if (other === newNodeId) {
      this.showToast('不能连接节点自身');
      return;
    }
    const duplicate = this.channels.some(
      (c) =>
        c.id !== id &&
        ((c.from === other && c.to === newNodeId) ||
          (c.from === newNodeId && c.to === other))
    );
    if (duplicate) {
      this.showToast('目标节点之间已存在浇道');
      return;
    }
    this.snapshot('重连浇道');
    if (endpoint === 'from') channel.from = newNodeId;
    else channel.to = newNodeId;
    this.lastAction = `重连浇道 ${id}`;
  }

  setChannelDiameter(id: string, diameter: number, live = false): void {
    const channel = this.channelById(id);
    if (!channel) return;
    if (!live) this.snapshot('调整管径');
    channel.diameter = clamp(diameter, DIAMETER_MIN, DIAMETER_MAX);
  }

  setChannelLevel(id: string, level: 1 | 2 | 3): void {
    const channel = this.channelById(id);
    if (!channel) return;
    this.snapshot('调整层级');
    channel.level = level;
  }

  channelLength(id: string): number | null {
    const channel = this.channelById(id);
    if (!channel) return null;
    const a = this.nodeById(channel.from);
    const b = this.nodeById(channel.to);
    if (!a || !b) return null;
    return distance(a.position, b.position);
  }

  // ---------- 冒口 ----------
  addRiser(position: Vec3): Riser | null {
    if (this.risers.length >= RISER_LIMIT) {
      this.showToast(`冒口数量已达上限 ${RISER_LIMIT} 个`);
      return null;
    }
    this.snapshot('添加冒口');
    const link = linkRiserToHotspot(position, this.hotspots);
    const riser: Riser = {
      id: uid('r'),
      position: { ...position },
      diameter: 70,
      height: 95,
      linkedHotSpotId: link.linkedHotSpotId,
      distance: link.distance
    };
    this.risers.push(riser);
    this.selectRiser(riser.id);
    this.lastAction = `添加冒口 ${riser.id}`;
    return riser;
  }

  deleteRiser(id: string): void {
    this.snapshot('删除冒口');
    this.risers = this.risers.filter((r) => r.id !== id);
    if (this.selectedRiserId === id) this.selectedRiserId = null;
    this.lastAction = `删除冒口 ${id}`;
  }

  moveRiser(id: string, position: Vec3): void {
    const riser = this.riserById(id);
    if (!riser) return;
    riser.position = { ...position };
    const link = linkRiserToHotspot(riser.position, this.hotspots);
    riser.linkedHotSpotId = link.linkedHotSpotId;
    riser.distance = link.distance;
  }

  setRiserDiameter(id: string, diameter: number, live = false): void {
    const riser = this.riserById(id);
    if (!riser) return;
    if (!live) this.snapshot('调整冒口直径');
    riser.diameter = clamp(diameter, 20, 200);
  }

  setRiserHeight(id: string, height: number, live = false): void {
    const riser = this.riserById(id);
    if (!riser) return;
    if (!live) this.snapshot('调整冒口高度');
    riser.height = clamp(height, 20, 300);
  }

  // ---------- 铸件 / 热节 ----------
  /** 热节由仓库按铸件参数生成，使无渲染层（测试/导入）也能完成冒口测距 */
  updateCasting(patch: Partial<CastingConfig>): void {
    this.snapshot('调整铸件');
    this.casting = { ...this.casting, ...patch };
    this.refreshHotspots();
  }

  private refreshHotspots(): void {
    this.hotspots = buildHotspots(this.casting);
    for (const riser of this.risers) {
      const link = linkRiserToHotspot(riser.position, this.hotspots);
      riser.linkedHotSpotId = link.linkedHotSpotId;
      riser.distance = link.distance;
    }
  }

  // ---------- 示例 / 重置 ----------
  resetSample(): void {
    const sample = buildSampleDesign(DEFAULT_CASTING);
    this.casting = { ...sample.casting };
    this.applyState(sample.state);
    this.history.clear();
    this.refreshHistoryFlags();
    this.refreshHotspots();
    this.lastAction = '载入示例方案';
  }

  clearNetwork(): void {
    this.snapshot('清空网络');
    this.nodes = [];
    this.channels = [];
    this.clearSelection();
    this.showToast('浇道网络已清空（冒口保留）');
  }

  // ---------- 导出 / 导入 ----------
  buildExportFile(): ExportFile {
    return {
      format: 'gating-riser-design',
      version: 1,
      exportedAt: new Date().toISOString(),
      casting: deepClone(this.casting),
      gating: {
        nodes: deepClone(this.nodes),
        channels: deepClone(this.channels)
      },
      risers: deepClone(this.risers),
      flowSummary: {
        imbalanceThreshold: this.imbalanceThreshold,
        unbalancedNodeIds: [...this.unbalancedNodeIds],
        detachedNodeIds: [...this.flow.detachedNodeIds]
      }
    };
  }

  loadFromJSON(data: unknown): { ok: boolean; error?: string } {
    if (typeof data !== 'object' || data === null) {
      return { ok: false, error: '文件格式不正确' };
    }
    const obj = data as Partial<ExportFile>;
    if (obj.format !== 'gating-riser-design' || !obj.gating || !Array.isArray(obj.risers)) {
      return { ok: false, error: '缺少 gating-riser-design 标识或数据字段' };
    }
    if (!Array.isArray(obj.gating.nodes) || !Array.isArray(obj.gating.channels)) {
      return { ok: false, error: '浇道节点/通道数据缺失' };
    }
    this.snapshot('导入方案');
    if (obj.casting) this.casting = deepClone(obj.casting);
    this.nodes = deepClone(obj.gating.nodes);
    this.channels = deepClone(obj.gating.channels);
    this.risers = deepClone(obj.risers).slice(0, RISER_LIMIT);
    this.clearSelection();
    this.refreshHotspots();
    this.lastAction = '导入方案';
    return { ok: true };
  }
}

function kindLabel(kind: NodeKind): string {
  const map: Record<NodeKind, string> = {
    cup: '浇口杯',
    'sprue-base': '直浇道底窝',
    junction: '横浇道节点',
    ingate: '内浇口',
    free: '自由节点'
  };
  return map[kind];
}

export const store = new DesignStore();
