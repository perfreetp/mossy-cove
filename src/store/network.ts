import { createSignal, createMemo } from 'solid-js'
import type { Edge, Intersection, Material, NetworkData, Road, RoadNetState, Tool, WidthLevel, XY } from '../types'
import { SANDBOX_SIZE, uid } from '../constants'
import { clamp, snapPointToConstraint } from '../lib/terrain'

const HISTORY_LIMIT = 100

function cloneState(s: RoadNetState): RoadNetState {
  return {
    intersections: structuredClone(s.intersections),
    roads: structuredClone(s.roads),
    edges: structuredClone(s.edges)
  }
}

function emptyState(): RoadNetState {
  return { intersections: {}, roads: {}, edges: {} }
}

/**
 * 路网状态仓库。
 * 所有结构性修改经 commit() 入栈撤销历史;拖动过程用 dragMove 直接改值,
 * 拖动结束时再把最终状态压栈(拖动前快照已在 dragBegin 保存)。
 */
export class NetworkStore {
  state = createSignal<RoadNetState>(emptyState())
  selectedNode = createSignal<string | null>(null)
  selectedRoad = createSignal<string | null>(null)
  tool = createSignal<Tool>('select')
  hoverNode = createSignal<string | null>(null)
  hoverEdge = createSignal<string | null>(null)
  /** 连接工具中已选中的第一个路口 */
  connectFrom = createSignal<string | null>(null)
  /** 拖动期间实时角度吸附提示信息 */
  snapHint = createSignal<string>('')

  private past: RoadNetState[] = []
  private future: RoadNetState[] = []
  private dragSnapshot: RoadNetState | null = null
  canUndo = createSignal(false)
  canRedo = createSignal(false)

  get(): RoadNetState {
    return this.state[0]()
  }
  private set(s: RoadNetState) {
    this.state[1](s)
    this.canUndo[1](this.past.length > 0)
    this.canRedo[1](this.future.length > 0)
  }

  private commit(next: RoadNetState) {
    this.past.push(cloneState(this.get()))
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.set(next)
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(cloneState(this.get()))
    this.set(prev)
    this.guardSelection()
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(cloneState(this.get()))
    this.set(next)
    this.guardSelection()
  }

  private guardSelection() {
    const s = this.get()
    if (this.selectedNode[0]() && !s.intersections[this.selectedNode[0]()!]) this.selectedNode[1](null)
    if (this.selectedRoad[0]() && !s.roads[this.selectedRoad[0]()!]) this.selectedRoad[1](null)
  }

  // ---------- 路口操作 ----------

  addIntersection(p: XY): string {
    const s = cloneState(this.get())
    const id = uid('n')
    s.intersections[id] = {
      id,
      x: clamp(p.x, 0, SANDBOX_SIZE),
      y: clamp(p.y, 0, SANDBOX_SIZE),
      angleConstraint: null,
      angleTolerance: 8
    }
    this.commit(s)
    this.selectedNode[1](id)
    this.selectedRoad[1](null)
    return id
  }

  setAngleConstraint(nodeId: string, angle: number | null, tolerance?: number) {
    const s = cloneState(this.get())
    const n = s.intersections[nodeId]
    if (!n) return
    n.angleConstraint = angle === null ? null : ((angle % 360) + 360) % 360
    if (tolerance !== undefined) n.angleTolerance = tolerance
    this.commit(s)
  }

  /** 拖动开始:保存快照,拖动期间不压栈 */
  dragBegin() {
    this.dragSnapshot = cloneState(this.get())
  }

  /**
   * 拖动某个路口。若该路口配置了角度约束,逐条检查与之相连的边:
   * 任一邻居方向不满足约束时,把当前点吸附到从该邻居出发的最近合法射线上。
   * 多个邻居冲突时依次叠加,取最后一次吸附结果(常见链式道路场景已够用)。
   */
  dragMove(nodeId: string, p: XY) {
    const s = this.get()
    const node = s.intersections[nodeId]
    if (!node) return
    let target: XY = { x: clamp(p.x, 0, SANDBOX_SIZE), y: clamp(p.y, 0, SANDBOX_SIZE) }
    const hint: string[] = []

    if (node.angleConstraint !== null) {
      for (const e of Object.values(s.edges)) {
        const otherId = e.a === nodeId ? e.b : e.b === nodeId ? e.a : null
        if (!otherId) continue
        const neighbor = s.intersections[otherId]
        const before = Math.atan2(target.y - neighbor.y, target.x - neighbor.x) * 180 / Math.PI
        target = snapPointToConstraint(neighbor, target, node.angleConstraint, node.angleTolerance)
        const after = Math.atan2(target.y - neighbor.y, target.x - neighbor.x) * 180 / Math.PI
        const delta = Math.abs(((after - before + 540) % 360) - 180)
        if (delta > 0.5) hint.push(`已吸附至 ${Math.round(node.angleConstraint)}° 约束轴`)
      }
    }
    // 直接原地修改并触发信号(结构化克隆在拖动中代价过高)
    node.x = target.x
    node.y = target.y
    this.snapHint[1](hint[0] ?? '')
    this.state[1]({ ...s })
  }

  dragEnd() {
    if (!this.dragSnapshot) return
    const cur = this.get()
    // 与快照无实质变化则不入栈
    const changed = JSON.stringify(cur) !== JSON.stringify(this.dragSnapshot)
    if (changed) {
      this.past.push(this.dragSnapshot)
      if (this.past.length > HISTORY_LIMIT) this.past.shift()
      this.future = []
      this.canUndo[1](true)
      this.canRedo[1](false)
    }
    this.dragSnapshot = null
    this.snapHint[1]('')
  }

  /**
   * 删除路口:与之相连的边全部移除。
   * 若恰好有两条边属于同一条 road,则把两条边自动接续为一条新边;
   * 其余边按"自动接续"规则尽量两两配对(同 roadId 优先)。
   */
  deleteIntersection(nodeId: string) {
    const s = cloneState(this.get())
    if (!s.intersections[nodeId]) return
    const incident = Object.values(s.edges).filter((e) => e.a === nodeId || e.b === nodeId)
    delete s.intersections[nodeId]

    // 按 roadId 分组,每组内的远端节点两两接续
    const groups = new Map<string, string[]>()
    for (const e of incident) {
      const far = e.a === nodeId ? e.b : e.a
      const g = groups.get(e.roadId) ?? []
      g.push(far)
      groups.set(e.roadId, g)
      delete s.edges[e.id]
    }
    for (const [roadId, fars] of groups) {
      for (let i = 0; i + 1 < fars.length; i += 2) {
        const a = fars[i]
        const b = fars[i + 1]
        if (a === b || s.intersections[a] === undefined || s.intersections[b] === undefined) continue
        // 避免重复边
        const exists = Object.values(s.edges).some(
          (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)
        )
        if (exists) continue
        const edgeId = uid('e')
        s.edges[edgeId] = { id: edgeId, a, b, roadId }
      }
    }
    // 清理失去所有边的道路
    const usedRoads = new Set(Object.values(s.edges).map((e) => e.roadId))
    for (const rid of Object.keys(s.roads)) {
      if (!usedRoads.has(rid)) delete s.roads[rid]
    }
    this.selectedNode[1](null)
    this.selectedRoad[1](null)
    this.commit(s)
  }

  // ---------- 道路 / 边操作 ----------

  connect(aId: string, bId: string, widthLevel: WidthLevel = 'secondary', material: Material = 'asphalt'): string | null {
    if (aId === bId) return null
    const s = cloneState(this.get())
    const exists = Object.values(s.edges).some(
      (e) => (e.a === aId && e.b === bId) || (e.a === bId && e.b === aId)
    )
    if (exists) return null
    const roadId = uid('r')
    s.roads[roadId] = { id: roadId, widthLevel, material }
    const edgeId = uid('e')
    s.edges[edgeId] = { id: edgeId, a: aId, b: bId, roadId }
    this.commit(s)
    this.selectedRoad[1](roadId)
    this.selectedNode[1](null)
    return roadId
  }

  /**
   * 在边的中点(或指定位置)插入新路口,把一条边拆成两条,
   * 两条新边继承原 roadId —— 因而整条道路的样式仍然一起更新。
   */
  splitEdge(edgeId: string, at?: XY): string | null {
    const s = cloneState(this.get())
    const edge = s.edges[edgeId]
    if (!edge) return null
    const a = s.intersections[edge.a]
    const b = s.intersections[edge.b]
    const mid = at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const nodeId = uid('n')
    s.intersections[nodeId] = {
      id: nodeId,
      x: clamp(mid.x, 0, SANDBOX_SIZE),
      y: clamp(mid.y, 0, SANDBOX_SIZE),
      angleConstraint: null,
      angleTolerance: 8
    }
    delete s.edges[edgeId]
    const e1 = uid('e')
    const e2 = uid('e')
    s.edges[e1] = { id: e1, a: edge.a, b: nodeId, roadId: edge.roadId }
    s.edges[e2] = { id: e2, a: nodeId, b: edge.b, roadId: edge.roadId }
    this.commit(s)
    this.selectedNode[1](nodeId)
    this.selectedRoad[1](null)
    return nodeId
  }

  /** 删除一条分段;若其道路再无分段则一并清理道路 */
  deleteEdge(edgeId: string) {
    const s = cloneState(this.get())
    const edge = s.edges[edgeId]
    if (!edge) return
    const rid = edge.roadId
    delete s.edges[edgeId]
    if (!Object.values(s.edges).some((e) => e.roadId === rid)) delete s.roads[rid]
    if (this.selectedRoad[0]() === rid) this.selectedRoad[1](null)
    this.commit(s)
  }

  /** 更新整条道路(其下所有分段共享 roadId,自动一起更新) */
  updateRoad(roadId: string, patch: Partial<Pick<Road, 'widthLevel' | 'material'>>) {
    const s = cloneState(this.get())
    const r = s.roads[roadId]
    if (!r) return
    Object.assign(r, patch)
    this.commit(s)
  }

  selectRoadByEdge(edgeId: string) {
    const e = this.get().edges[edgeId]
    if (!e) return
    this.selectedRoad[1](e.roadId)
    this.selectedNode[1](null)
  }

  // ---------- 导入 / 导出 ----------

  exportData(): NetworkData {
    const s = this.get()
    return {
      version: 1,
      intersections: Object.values(s.intersections),
      roads: Object.values(s.roads),
      edges: Object.values(s.edges)
    }
  }

  importData(data: NetworkData) {
    const s: RoadNetState = { intersections: {}, roads: {}, edges: {} }
    for (const n of data.intersections) s.intersections[n.id] = { ...n }
    for (const r of data.roads) s.roads[r.id] = { ...r }
    for (const e of data.edges) {
      if (!s.intersections[e.a] || !s.intersections[e.b] || !s.roads[e.roadId]) continue
      s.edges[e.id] = { ...e }
    }
    this.past.push(cloneState(this.get()))
    this.future = []
    this.selectedNode[1](null)
    this.selectedRoad[1](null)
    this.set(s)
  }

  clear() {
    this.commit(emptyState())
    this.selectedNode[1](null)
    this.selectedRoad[1](null)
  }

  /** 邻接表(供路网图等使用) */
  adjacency = createMemo(() => {
    const s = this.get()
    const adj = new Map<string, Set<string>>()
    for (const id of Object.keys(s.intersections)) adj.set(id, new Set())
    for (const e of Object.values(s.edges)) {
      adj.get(e.a)?.add(e.b)
      adj.get(e.b)?.add(e.a)
    }
    return adj
  })

  /** 路口 → 关联道路 id 列表 */
  incidentEdges(nodeId: string): Edge[] {
    return Object.values(this.get().edges).filter((e) => e.a === nodeId || e.b === nodeId)
  }
}

export const store = new NetworkStore()

// 挂到 window 作为权威单例,供运行时调试与自动化测试访问
;(window as unknown as { __networkStore?: NetworkStore }).__networkStore = store
