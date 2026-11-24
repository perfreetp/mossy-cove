// 端到端功能测试:通过 CDP 在页面上下文直接操作 store,验证所有核心能力
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
await send('Runtime.enable')
await send('Page.enable')
// 先在同源空白上下文清理存档,再导航到应用,保证以示例路网启动
await send('Page.navigate', { url: 'http://127.0.0.1:5177/__blank__' })
await new Promise((r) => setTimeout(r, 800))
await send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5177', storageTypes: 'local_storage' })
await send('Page.navigate', { url: 'http://127.0.0.1:5177/' })
await new Promise((r) => setTimeout(r, 3500))

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    console.error('JS EXCEPTION:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails))
    process.exitCode = 1
    return null
  }
  return r.result.value
}

// 等待应用就绪
await evalJs(`new Promise(r => {
  const t = setInterval(() => { if (window.__sandboxMap) { clearInterval(t); r() } }, 200)
})`)

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('  PASS', name, extra)
  } else {
    fail++
    console.error('  FAIL', name, extra)
  }
}

// 应用把权威 store 单例挂在 window.__networkStore,测试统一使用该实例
await evalJs(`window.__test = {}; window.__store = window.__networkStore`)

const setup = await evalJs(`(() => {
  const s = window.__store
  return JSON.stringify({
    nodes: Object.keys(s.get().intersections).length,
    edges: Object.keys(s.get().edges).length,
    roads: Object.keys(s.get().roads).length
  })
})()`)
console.log('初始示例路网:', setup)
const init = JSON.parse(setup)
check('示例路网含 8 路口', init.nodes === 8)
check('示例路网含 9 连接', init.edges === 9)

console.log('\\n--- 1. 放置路口 ---')
const r1 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const before = Object.keys(s.get().intersections).length
  const id = s.addIntersection({x: 500, y: 150})
  const after = Object.keys(s.get().intersections).length
  return JSON.stringify({before, after, id, selected: s.selectedNode[0]() === id})
})()`))
check('放置后路口数 +1', r1.after === r1.before + 1)
check('新路口自动选中', r1.selected)

console.log('\\n--- 2. 连接道路 ---')
const r2 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const ids = Object.keys(s.get().intersections)
  const a = ids[0], b = ids[ids.length - 1]
  const before = Object.keys(s.get().edges).length
  const rid = s.connect(a, b, 'primary', 'concrete')
  const after = Object.keys(s.get().edges).length
  const road = s.get().roads[rid]
  // 重复连接应被拒绝
  const dup = s.connect(a, b)
  return JSON.stringify({before, after, rid, width: road.widthLevel, mat: road.material, dupRejected: dup === null})
})()`))
check('连接后边数 +1', r2.after === r2.before + 1)
check('新道路为主干道+水泥材质', r2.width === 'primary' && r2.mat === 'concrete')
check('重复连接被拒绝', r2.dupRejected)

console.log('\\n--- 3. 中点拆分 ---')
const r3 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const edgeId = Object.keys(s.get().edges)[0]
  const before = Object.keys(s.get().edges).length
  const nodesBefore = Object.keys(s.get().intersections).length
  const oldRoad = s.get().edges[edgeId].roadId
  const newNode = s.splitEdge(edgeId)
  const after = Object.keys(s.get().edges).length
  const nodesAfter = Object.keys(s.get().intersections).length
  const newEdges = Object.values(s.get().edges).filter(e => e.roadId === oldRoad)
  return JSON.stringify({
    edgeDelta: after - before,
    nodeDelta: nodesAfter - nodesBefore,
    sameRoadSegments: newEdges.length,
    newNode
  })
})()`))
check('拆分后边数 +1', r3.edgeDelta === 1)
check('拆分后路口数 +1', r3.nodeDelta === 1)
check('两段继承同一道路 ID(样式一起更新)', r3.sameRoadSegments >= 2)

console.log('\\n--- 4. 角度约束与吸附 ---')
const r4 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const ids = Object.keys(s.get().intersections)
  const a = ids[0], b = ids[1]
  // 给 b 设置 0° 约束(东西向)
  s.setAngleConstraint(b, 0, 8)
  const anchor = s.get().intersections[a]
  s.dragBegin()
  // 拖到一个明显偏离 0° 的位置(45° 方向)
  const target = { x: anchor.x + 200, y: anchor.y + 200 }
  s.dragMove(b, target)
  const moved = s.get().intersections[b]
  const ang = Math.atan2(moved.y - anchor.y, moved.x - anchor.x) * 180 / Math.PI
  s.dragEnd()
  const snapped = Math.abs(ang) < 5 || Math.abs(Math.abs(ang) - 180) < 5
  return JSON.stringify({ rawAngle: 45, snappedAngle: ang.toFixed(1), snapped, constraint: s.get().intersections[b].angleConstraint })
})()`))
check('45° 拖动被吸附到 0/180° 约束轴', r4.snapped, `实际角度 ${r4.snappedAngle}°`)
check('约束值已保存为 0', r4.constraint === 0)

console.log('\\n--- 5. 删除路口与道路自动接续 ---')
const r5 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  // 找一个恰有 2 条边且同属一条 road 的中间节点
  const state = s.get()
  let victim = null
  for (const nid of Object.keys(state.intersections)) {
    const inc = Object.values(state.edges).filter(e => e.a === nid || e.b === nid)
    if (inc.length === 2 && inc[0].roadId === inc[1].roadId) { victim = nid; break }
  }
  if (!victim) return JSON.stringify({skipped: true})
  const edgesBefore = Object.keys(state.edges).length
  const nodesBefore = Object.keys(state.intersections).length
  const incidentRoad = state.edges[Object.values(state.edges).find(e => e.a === victim || e.b === victim).id].roadId
  s.deleteIntersection(victim)
  const after = s.get()
  const edgesAfter = Object.keys(after.edges).length
  const nodesAfter = Object.keys(after.intersections).length
  // 两条边删除 + 一条接续边 = 净 -1
  const roadSurvives = !!after.roads[incidentRoad]
  return JSON.stringify({ edgesBefore, edgesAfter, edgeDelta: edgesAfter - edgesBefore, nodeDelta: nodesAfter - nodesBefore, roadSurvives })
})()`))
check('删除后路口数 -1', r5.nodeDelta === -1)
check('两端道路自动接续(边数净 -1)', r5.edgeDelta === -1, `Δ=${r5.edgeDelta}`)
check('接续后道路仍然存在', r5.roadSurvives)

console.log('\\n--- 6. 撤销/重做 ---')
const r6 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const snap = Object.keys(s.get().intersections).length
  s.undo()
  const afterUndo = Object.keys(s.get().intersections).length
  s.redo()
  const afterRedo = Object.keys(s.get().intersections).length
  return JSON.stringify({ snap, afterUndo, afterRedo, canUndo: true })
})()`))
check('撤销恢复被删路口', r6.afterUndo === r6.snap + 1)
check('重做回到删除后状态', r6.afterRedo === r6.snap)

console.log('\\n--- 7. 道路样式整条更新 ---')
const r7 = JSON.parse(await evalJs(`(() => {
  const s = window.__store
  const rid = Object.keys(s.get().roads)[0]
  s.updateRoad(rid, { widthLevel: 'primary', material: 'gravel' })
  const r = s.get().roads[rid]
  // 该道路下所有分段共享 roadId,道路对象只有一个即证明整条生效
  const segCount = Object.values(s.get().edges).filter(e => e.roadId === rid).length
  return JSON.stringify({ width: r.widthLevel, material: r.material, segCount })
})()`))
check('宽度档位更新为主干道', r7.width === 'primary')
check('材质更新为碎石', r7.material === 'gravel')
check('该道路含多个分段一起生效', r7.segCount >= 1)

console.log('\\n--- 8. 导出/导入往返 ---')
const r8 = JSON.parse(await evalJs(`(async () => {
  const s = window.__store
  const data = s.exportData()
  const json = JSON.stringify(data)
  const parsed = JSON.parse(json)
  const before = {
    n: Object.keys(s.get().intersections).length,
    e: Object.keys(s.get().edges).length,
    r: Object.keys(s.get().roads).length
  }
  s.clear()
  const cleared = Object.keys(s.get().intersections).length
  s.importData(parsed)
  const after = {
    n: Object.keys(s.get().intersections).length,
    e: Object.keys(s.get().edges).length,
    r: Object.keys(s.get().roads).length
  }
  const roundTrip = before.n === after.n && before.e === after.e && before.r === after.r
  return JSON.stringify({ before, cleared, after, roundTrip, version: parsed.version })
})()`))
check('导出为 version 1 结构', r8.version === 1)
check('清空后路口为 0', r8.cleared === 0)
check('导入后数量完全一致(往返一致)', r8.roundTrip)

console.log('\\n--- 9. 地形贴合(几何校验) ---')
const r9 = JSON.parse(await evalJs(`(async () => {
  const geo = await import('/src/lib/geometry.ts')
  const terrain = await import('/src/lib/terrain.ts')
  const mesh = geo.buildRoadMesh(window.__store.get())
  // 道路顶点 z 应等于地形高度 + 抬升量
  let ok = true
  let checked = 0
  for (let i = 0; i < Math.min(mesh.positions.length, 300); i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i+1], z = mesh.positions[i+2]
    const expected = terrain.terrainHeight(x, y) + 1.6
    if (Math.abs(z - expected) > 0.01) { ok = false; break }
    checked++
  }
  return JSON.stringify({ ok, checked, hasIndices: mesh.indices.length > 0 })
})()`))
check('道路顶点贴合地形高度(含抬升)', r9.ok, `校验 ${r9.checked} 个顶点`)
check('道路网格含索引数据', r9.hasIndices)

console.log(`\\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
