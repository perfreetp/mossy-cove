import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CSS2DObject,
  CSS2DRenderer
} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Channel, GatingNode, HotSpot, Riser, Vec3 } from './types';
import { clamp, formatMm, formatPct } from './geometry';
import { DIAMETER_MAX, DIAMETER_MIN, LEVEL_META, NODE_META } from './meta';
import { snapToEndpoints, SNAP_TOLERANCE } from './snapping';
import { createCasting, type CastingGeometry } from './casting';
import { store, type ToolMode } from './store.svelte';

type PickKind = 'node' | 'channel' | 'riser' | 'diamHandle' | 'riserDiam';

interface PickInfo {
  kind: PickKind;
  id: string;
}

interface NodeView {
  mesh: THREE.Mesh;
  label: CSS2DObject;
  ring: THREE.Mesh;
}

interface ChannelView {
  mesh: THREE.Mesh;
  arrow: THREE.Mesh;
  label: CSS2DObject;
  handle: THREE.Mesh;
}

interface RiserView {
  group: THREE.Group;
  body: THREE.Mesh;
  neck: THREE.Mesh;
  label: CSS2DObject;
  diamHandle: THREE.Mesh;
}

const toVec3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const UP = new THREE.Vector3(0, 1, 0);

interface DragState {
  type: 'node' | 'riser' | 'diam' | 'riser-diam';
  id: string;
  plane: THREE.Plane;
  startPoint: THREE.Vector3;
  /** 管径拖拽：上一帧在平面上的交点，用于增量调整 */
  lastPoint?: THREE.Vector3;
  baseDiameter?: number;
  /** 拖出基准点的方向（决定增减符号） */
  axis?: THREE.Vector3;
}

export class Viewport {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private gatingGroup = new THREE.Group();
  private nodeGroup = new THREE.Group();
  private channelGroup = new THREE.Group();
  private riserGroup = new THREE.Group();
  private hotspotGroup = new THREE.Group();
  private castingHolder = new THREE.Group();
  private snapRing: THREE.Mesh;
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;

  private nodeViews = new Map<string, NodeView>();
  private channelViews = new Map<string, ChannelView>();
  private riserViews = new Map<string, RiserView>();
  private linkLines = new THREE.LineSegments();
  private casting: CastingGeometry | null = null;
  private castingSignature = '';

  private drag: DragState | null = null;
  private snapTargetId: string | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    Object.assign(this.labelRenderer.domElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      pointerEvents: 'none'
    });
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(0x101418);
    this.scene.fog = new THREE.Fog(0x101418, 1800, 3600);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 1, 8000);
    this.camera.position.set(620, 520, 720);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 140, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(500, 900, 400);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -900;
    key.shadow.camera.right = 900;
    key.shadow.camera.top = 900;
    key.shadow.camera.bottom = -900;
    const fill = new THREE.DirectionalLight(0x90caf9, 0.5);
    fill.position.set(-600, 300, -500);
    this.scene.add(ambient, key, fill);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x1b242b, roughness: 1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(2000, 40, 0x3a4750, 0x263238);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    this.snapRing = new THREE.Mesh(
      new THREE.TorusGeometry(SNAP_TOLERANCE * 0.7, 1.6, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0x69f0ae })
    );
    this.snapRing.rotation.x = Math.PI / 2;
    this.snapRing.visible = false;
    this.scene.add(this.snapRing);

    this.scene.add(
      this.castingHolder,
      this.hotspotGroup,
      this.gatingGroup,
      this.nodeGroup,
      this.channelGroup,
      this.riserGroup
    );
    this.gatingGroup.add(this.linkLines);
    this.linkLines.frustumCulled = false;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    // 拖拽中即使指针离开画布也能持续响应（pointer capture 的兜底）
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  // ---------------- 渲染循环 ----------------
  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }

  /** 窗口级移动：仅在拖拽状态下处理，避免与画布自身监听重复 */
  private onWindowPointerMove = (event: PointerEvent): void => {
    if (this.drag) this.onPointerMove(event);
  };

  // ---------------- 状态同步（由 Svelte $effect 驱动） ----------------
  sync(): void {
    this.syncCasting();
    this.syncChannels();
    this.syncNodes();
    this.syncRisers();
    this.syncLinkLines();
    this.updateStatuses();
  }

  private syncCasting(): void {
    const c = store.casting;
    const signature = JSON.stringify(c);
    if (signature === this.castingSignature && this.casting) return;
    this.castingSignature = signature;

    this.castingHolder.clear();
    this.hotspotGroup.clear();
    this.casting = createCasting(c);
    this.castingHolder.add(this.casting.group);
    // 热节数据源归 store 所有（store.refreshHotspots），视口只负责可视化
    for (const hs of store.hotspots) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(hs.radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color: 0xef5350,
          transparent: true,
          opacity: 0.35,
          emissive: 0xb71c1c,
          emissiveIntensity: 0.35
        })
      );
      sphere.position.copy(toVec3(hs.position));
      this.hotspotGroup.add(sphere);

      const label = makeLabel('hotspot-label', hs.label);
      label.position.copy(toVec3(hs.position).add(new THREE.Vector3(0, hs.radius + 8, 0)));
      this.hotspotGroup.add(label);
    }
  }

  private syncNodes(): void {
    const seen = new Set<string>();
    for (const node of store.nodes) {
      seen.add(node.id);
      let view = this.nodeViews.get(node.id);
      if (!view) {
        view = this.createNodeView(node);
        this.nodeViews.set(node.id, view);
        this.nodeGroup.add(view.mesh, view.ring);
        this.nodeGroup.add(view.label);
      }
      view.mesh.position.copy(toVec3(node.position));
      view.ring.position.copy(toVec3(node.position));
      view.label.position.copy(toVec3(node.position).add(new THREE.Vector3(0, 22, 0)));
      this.refreshNodeLabel(node, view);
    }
    for (const [id, view] of this.nodeViews) {
      if (!seen.has(id)) {
        this.nodeGroup.remove(view.mesh, view.ring, view.label);
        view.mesh.geometry.dispose();
        (view.mesh.material as THREE.Material).dispose();
        this.nodeViews.delete(id);
      }
    }
  }

  private createNodeView(node: GatingNode): NodeView {
    const meta = NODE_META[node.kind];
    let geometry: THREE.BufferGeometry;
    switch (node.kind) {
      case 'cup':
        geometry = new THREE.CylinderGeometry(17, 7, 28, 24);
        break;
      case 'sprue-base':
        geometry = new THREE.SphereGeometry(11, 20, 16);
        break;
      case 'junction':
        geometry = new THREE.SphereGeometry(8.5, 18, 14);
        break;
      case 'ingate':
        geometry = new THREE.BoxGeometry(13, 13, 13);
        break;
      default:
        geometry = new THREE.OctahedronGeometry(9);
    }
    const material = new THREE.MeshStandardMaterial({
      color: meta.color,
      roughness: 0.45,
      metalness: 0.25,
      emissive: 0x000000
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.userData = { kind: 'node', id: node.id } satisfies PickInfo;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(15, 1.4, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x40c4ff })
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;

    const label = makeLabel('node-label', '');
    return { mesh, label, ring };
  }

  private refreshNodeLabel(node: GatingNode, view: NodeView): void {
    const result = store.flow.nodes[node.id];
    const div = view.label.element as HTMLDivElement;
    const meta = NODE_META[node.kind];
    const inflow = result?.inflow ?? 0;
    const splits = result ? Object.values(result.splitRatios) : [];
    let html = `<div class="nl-title">${meta.label}</div>`;
    html += `<div>流入 ${formatPct(inflow)}</div>`;
    if (splits.length >= 2) {
      const parts = splits.map((s) => formatPct(s)).join(' / ');
      html += `<div>分出 ${parts}</div>`;
    }
    div.innerHTML = html;
    div.classList.toggle(
      'warn',
      !!result && !result.balanced && splits.length >= 2
    );
    div.classList.toggle('dim', store.flow.detachedNodeIds.includes(node.id));
  }

  private syncChannels(): void {
    const seen = new Set<string>();
    for (const channel of store.channels) {
      seen.add(channel.id);
      const from = store.nodeById(channel.from);
      const to = store.nodeById(channel.to);
      if (!from || !to) continue;
      let view = this.channelViews.get(channel.id);
      if (!view) {
        view = this.createChannelView(channel);
        this.channelViews.set(channel.id, view);
        this.channelGroup.add(view.mesh, view.arrow, view.handle);
        this.channelGroup.add(view.label);
      }
      this.layoutChannel(view, channel, from.position, to.position);
    }
    for (const [id, view] of this.channelViews) {
      if (!seen.has(id)) {
        this.channelGroup.remove(view.mesh, view.arrow, view.handle, view.label);
        view.mesh.geometry.dispose();
        (view.mesh.material as THREE.Material).dispose();
        this.channelViews.delete(id);
      }
    }
  }

  private createChannelView(channel: Channel): ChannelView {
    const material = new THREE.MeshStandardMaterial({
      color: LEVEL_META[channel.level].color,
      roughness: 0.5,
      metalness: 0.3
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), material);
    mesh.castShadow = true;
    mesh.userData = { kind: 'channel', id: channel.id } satisfies PickInfo;

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 16),
      new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 })
    );

    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x29b6f6,
        emissiveIntensity: 0.6
      })
    );
    handle.visible = false;
    handle.userData = { kind: 'diamHandle', id: channel.id } satisfies PickInfo;

    const label = makeLabel('channel-label', '');
    return { mesh, arrow, handle, label };
  }

  private layoutChannel(view: ChannelView, channel: Channel, a: Vec3, b: Vec3): void {
    const va = toVec3(a);
    const vb = toVec3(b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const radius = channel.diameter / 2;
    const mid = va.clone().add(vb).multiplyScalar(0.5);

    view.mesh.position.copy(mid);
    view.mesh.scale.set(radius, len, radius);
    if (len > 1e-6) {
      view.mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    }

    // 流向箭头
    const arrowPos = va.clone().lerp(vb, 0.62);
    view.arrow.position.copy(arrowPos);
    view.arrow.scale.set(radius * 0.85, radius * 2.2, radius * 0.85);
    if (len > 1e-6) view.arrow.quaternion.setFromUnitVectors(UP, dir.clone().normalize());

    // 管径手柄
    view.handle.position.copy(mid);
    view.handle.scale.setScalar(5);

    const share = store.flow.channels[channel.id]?.share ?? 0;
    const div = view.label.element as HTMLDivElement;
    div.innerHTML =
      `<span class="cl-level">L${channel.level}</span> ` +
      `Ø${channel.diameter.toFixed(1)} · ${len.toFixed(0)}mm · ${formatPct(share)}`;
    view.label.position.copy(mid.clone().add(new THREE.Vector3(0, radius + 10, 0)));
  }

  private syncRisers(): void {
    const seen = new Set<string>();
    for (const riser of store.risers) {
      seen.add(riser.id);
      let view = this.riserViews.get(riser.id);
      if (!view) {
        view = this.createRiserView(riser);
        this.riserViews.set(riser.id, view);
        this.riserGroup.add(view.group);
        this.riserGroup.add(view.label);
      }
      const r = riser.diameter / 2;
      view.group.position.set(riser.position.x, riser.position.y, riser.position.z);
      view.body.scale.set(r, riser.height, r);
      view.body.position.set(0, riser.height / 2, 0);
      view.neck.scale.set(r * 0.45, 10, r * 0.45);
      view.neck.position.set(0, 5, 0);
      view.diamHandle.position.set(r + 8, riser.height * 0.5, 0);
      view.diamHandle.scale.setScalar(5);

      const div = view.label.element as HTMLDivElement;
      const dist =
        riser.distance === null ? '—' : `${riser.distance.toFixed(0)}mm`;
      div.innerHTML =
        `<div class="rl-title">冒口 Ø${riser.diameter.toFixed(0)}×${riser.height.toFixed(0)}</div>` +
        `<div>距热节 ${dist}</div>`;
      view.label.position.set(0, riser.height + 18, 0);
    }
    for (const [id, view] of this.riserViews) {
      if (!seen.has(id)) {
        this.riserGroup.remove(view.group, view.label);
        this.riserViews.delete(id);
      }
    }
  }

  private createRiserView(riser: Riser): RiserView {
    const group = new THREE.Group();
    group.position.set(riser.position.x, riser.position.y, riser.position.z);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 28),
      new THREE.MeshStandardMaterial({
        color: 0xab47bc,
        roughness: 0.4,
        metalness: 0.25
      })
    );
    body.castShadow = true;
    body.userData = { kind: 'riser', id: riser.id } satisfies PickInfo;

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20),
      new THREE.MeshStandardMaterial({ color: 0x6a1b9a, roughness: 0.6 })
    );
    neck.userData = { kind: 'riser', id: riser.id } satisfies PickInfo;

    const diamHandle = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xce93d8,
        emissiveIntensity: 0.7
      })
    );
    diamHandle.userData = { kind: 'riserDiam', id: riser.id } satisfies PickInfo;

    group.add(body, neck, diamHandle);
    const label = makeLabel('riser-label', '');
    return { group, body, neck, label, diamHandle };
  }

  private syncLinkLines(): void {
    if (!this.casting) return;
    const positions: number[] = [];
    const hsMap = new Map(this.casting.hotspots.map((h) => [h.id, h]));
    for (const riser of store.risers) {
      if (!riser.linkedHotSpotId) continue;
      const hs = hsMap.get(riser.linkedHotSpotId);
      if (!hs) continue;
      positions.push(
        riser.position.x, riser.position.y, riser.position.z,
        hs.position.x, hs.position.y, hs.position.z
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.linkLines.geometry.dispose();
    this.linkLines.geometry = geometry;
    this.linkLines.material = new THREE.LineDashedMaterial({
      color: 0xef5350,
      dashSize: 10,
      gapSize: 6,
      transparent: true,
      opacity: 0.85
    });
    this.linkLines.computeLineDistances();
  }

  private updateStatuses(): void {
    const detached = new Set(store.flow.detachedNodeIds);
    for (const node of store.nodes) {
      const view = this.nodeViews.get(node.id);
      if (!view) continue;
      const mat = view.mesh.material as THREE.MeshStandardMaterial;
      const result = store.flow.nodes[node.id];
      const unbalanced = !!result && !result.balanced && Object.keys(result.splitRatios).length >= 2;
      if (unbalanced) {
        mat.emissive.setHex(0xff1744);
        mat.emissiveIntensity = 0.85;
      } else if (store.selectedNodeId === node.id || store.connectSourceId === node.id) {
        mat.emissive.setHex(0x40c4ff);
        mat.emissiveIntensity = 0.7;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
      mat.transparent = detached.has(node.id);
      mat.opacity = detached.has(node.id) ? 0.35 : 1;
      const ringColor = store.connectSourceId === node.id ? 0x69f0ae : 0x40c4ff;
      (view.ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
      view.ring.visible =
        store.selectedNodeId === node.id || store.connectSourceId === node.id;
    }

    for (const channel of store.channels) {
      const view = this.channelViews.get(channel.id);
      if (!view) continue;
      const mat = view.mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(
        store.selectedChannelId === channel.id ? 0x4fc3f7 : LEVEL_META[channel.level].color
      );
      view.handle.visible = store.selectedChannelId === channel.id;
      const detached = (store.flow.channels[channel.id]?.share ?? 0) <= 1e-12;
      mat.transparent = detached;
      mat.opacity = detached ? 0.3 : 1;
    }

    for (const riser of store.risers) {
      const view = this.riserViews.get(riser.id);
      if (!view) continue;
      const mat = view.body.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(store.selectedRiserId === riser.id ? 0x40c4ff : 0x000000);
      mat.emissiveIntensity = store.selectedRiserId === riser.id ? 0.6 : 0;
      view.diamHandle.visible = store.selectedRiserId === riser.id;
    }
  }

  // ---------------- 拾取与交互 ----------------
  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.nodeViews.values()) targets.push(v.mesh);
    for (const v of this.channelViews.values()) {
      targets.push(v.mesh);
      if (v.handle.visible) targets.push(v.handle);
    }
    for (const v of this.riserViews.values()) {
      targets.push(v.group);
      if (v.diamHandle.visible) targets.push(v.diamHandle);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    return hits.length > 0 ? hits[0] : null;
  }

  private findPick(object: THREE.Object3D | null): PickInfo | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const data = current.userData as Partial<PickInfo>;
      if (data.kind && data.id) return { kind: data.kind, id: data.id };
      current = current.parent;
    }
    return null;
  }

  private intersectPlane(plane: THREE.Plane): THREE.Vector3 | null {
    const target = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(plane, target);
    return hit ? target : null;
  }

  private cameraFacingPlane(point: THREE.Vector3): THREE.Plane {
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.updatePointer(event);
    const mode: ToolMode = store.mode;

    // 放置冒口
    if (mode === 'add-riser') {
      this.handlePlaceRiser();
      return;
    }

    const hit = this.pick();
    const pick = this.findPick(hit?.object ?? null);

    // 添加节点（空白处）
    if (mode === 'add-node') {
      if (pick?.kind === 'node') {
        store.showToast('该位置已有节点，已切换为选择模式');
        store.setMode('select');
        store.selectNode(pick.id);
        return;
      }
      const point = this.pointForNewNode();
      store.addNode(store.pendingNodeKind, point);
      return;
    }

    if (!pick) {
      if (mode === 'connect') {
        store.connectSourceId = null;
        store.showToast('已取消连线');
      } else {
        store.clearSelection();
      }
      return;
    }

    if (mode === 'connect') {
      this.handleConnectPick(pick);
      return;
    }

    // 选择 / 拖拽模式
    if (pick.kind === 'node') {
      store.selectNode(pick.id);
      const node = store.nodeById(pick.id);
      if (node) {
        const p = toVec3(node.position);
        this.drag = {
          type: 'node',
          id: pick.id,
          plane: this.cameraFacingPlane(p),
          startPoint: p.clone()
        };
        store.snapshot('移动节点');
        this.beginDrag(event);
      }
    } else if (pick.kind === 'channel') {
      store.selectChannel(pick.id);
    } else if (pick.kind === 'diamHandle') {
      this.beginDiameterDrag(pick.id);
    } else if (pick.kind === 'riser') {
      store.selectRiser(pick.id);
      const riser = store.riserById(pick.id);
      if (riser) {
        const p = toVec3(riser.position);
        this.drag = {
          type: 'riser',
          id: pick.id,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(UP, p),
          startPoint: p.clone()
        };
        store.snapshot('移动冒口');
        this.beginDrag(event);
      }
    } else if (pick.kind === 'riserDiam') {
      this.beginRiserDiameterDrag(pick.id);
    }
  };

  private beginDrag(event: PointerEvent): void {
    this.controls.enabled = false;
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      /* 某些浏览器环境不支持时忽略 */
    }
  }

  private beginDiameterDrag(channelId: string): void {
    const channel = store.channelById(channelId);
    const from = channel && store.nodeById(channel.from);
    const to = channel && store.nodeById(channel.to);
    if (!channel || !from || !to) return;
    const va = toVec3(from.position);
    const vb = toVec3(to.position);
    const axis = vb.clone().sub(va).normalize();
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    store.selectChannel(channelId);
    store.snapshot('调整管径');
    this.drag = {
      type: 'diam',
      id: channelId,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axis, mid),
      startPoint: mid.clone(),
      lastPoint: mid.clone(),
      axis,
      baseDiameter: channel.diameter
    };
    this.controls.enabled = false;
  }

  private beginRiserDiameterDrag(riserId: string): void {
    const riser = store.riserById(riserId);
    if (!riser) return;
    store.selectRiser(riserId);
    store.snapshot('调整冒口直径');
    const p = toVec3(riser.position);
    this.drag = {
      type: 'riser-diam',
      id: riserId,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(UP, p),
      startPoint: p.clone(),
      lastPoint: p.clone(),
      baseDiameter: riser.diameter
    };
    this.controls.enabled = false;
  }

  private handleConnectPick(pick: PickInfo): void {
    if (pick.kind !== 'node') {
      store.showToast('请选择节点作为连线端点');
      return;
    }
    if (!store.connectSourceId) {
      store.connectSourceId = pick.id;
      store.showToast('已选起点，请再点击一个目标节点');
      return;
    }
    if (store.connectSourceId === pick.id) {
      store.connectSourceId = null;
      store.showToast('已取消连线');
      return;
    }
    const channel = store.addChannel(store.connectSourceId, pick.id);
    store.connectSourceId = null;
    if (channel) {
      store.selectChannel(channel.id);
      store.showToast('浇道已连接，流量已重新分配');
    }
  }

  private pointForNewNode(): Vec3 {
    // 优先落在铸件表面，否则落到相机平面的固定距离处
    if (this.casting) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const surfaceHits = this.raycaster.intersectObjects(this.casting.pickMeshes, false);
      if (surfaceHits.length > 0) {
        const p = surfaceHits[0].point;
        return { x: p.x, y: p.y, z: p.z };
      }
    }
    const center = new THREE.Vector3(0, store.casting.height * 0.4, 0);
    const plane = this.cameraFacingPlane(center);
    const p = this.intersectPlane(plane) ?? center;
    return { x: p.x, y: Math.max(0, p.y), z: p.z };
  }

  private handlePlaceRiser(): void {
    if (!this.casting) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.casting.pickMeshes, false);
    if (hits.length === 0) {
      store.showToast('请在铸件表面放置冒口');
      return;
    }
    const p = hits[0].point;
    const clamped = this.casting.clampToTop({ x: p.x, y: p.y, z: p.z });
    if (!clamped) {
      store.showToast('该位置不在铸件顶面范围内');
      return;
    }
    const riser = store.addRiser(clamped);
    if (riser) store.showToast(`冒口已放置，距最近热节 ${formatMm(riser.distance, 0)}`);
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);

    if (this.drag) {
      this.handleDragMove();
      return;
    }

    // 悬停光标
    const mode = store.mode;
    if (mode === 'add-node' || mode === 'add-riser') {
      this.renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    const hit = this.pick();
    const pick = this.findPick(hit?.object ?? null);
    this.renderer.domElement.style.cursor = pick ? 'pointer' : 'default';
  };

  private handleDragMove(): void {
    const drag = this.drag;
    if (!drag) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = this.intersectPlane(drag.plane);
    if (!p) return;

    if (drag.type === 'node') {
      let position: Vec3 = { x: p.x, y: Math.max(0, p.y), z: p.z };
      this.snapTargetId = null;
      this.snapRing.visible = false;
      if (store.snapEnabled) {
        const snap = snapToEndpoints(position, store.nodes, drag.id);
        if (snap) {
          position = snap.position;
          this.snapTargetId = snap.nodeId;
          this.snapRing.visible = true;
          this.snapRing.position.copy(toVec3(snap.position));
        }
      }
      store.moveNode(drag.id, position);
    } else if (drag.type === 'riser') {
      const candidate = { x: p.x, y: p.y, z: p.z };
      const clamped = this.casting?.clampToTop(candidate) ?? null;
      if (clamped) store.moveRiser(drag.id, clamped);
    } else if (drag.type === 'diam') {
      // 增量式改径：本帧相对上一帧在平面上的位移映射为管径变化，
      // 可连续增大/缩小，不受手柄与中点距离限制。
      const last = drag.lastPoint ?? drag.startPoint;
      const delta = p.clone().sub(last).length() * (movingOutward(p, drag) ? 1 : -1);
      drag.lastPoint = p.clone();
      const channel = store.channelById(drag.id);
      const current = channel?.diameter ?? drag.baseDiameter ?? 10;
      const next = clamp(current + delta * 0.5, DIAMETER_MIN, DIAMETER_MAX);
      // 拖动时实时改径 → flow 派生实时重算
      store.setChannelDiameter(drag.id, next, true);
    } else if (drag.type === 'riser-diam') {
      const last = drag.lastPoint ?? drag.startPoint;
      const delta = p.clone().sub(last).length() * (movingOutward(p, drag) ? 1 : -1);
      drag.lastPoint = p.clone();
      const riser = store.riserById(drag.id);
      const current = riser?.diameter ?? drag.baseDiameter ?? 60;
      const next = clamp(current + delta * 0.6, 20, 200);
      store.setRiserDiameter(drag.id, next, true);
    }
  }

  private onPointerUp = (): void => {
    if (this.drag) {
      if (this.drag.type === 'node' && this.snapTargetId && store.snapEnabled) {
        store.showToast('已吸附到邻近浇道端点');
      }
      if (this.drag.type === 'diam') {
        const ch = store.channelById(this.drag.id);
        if (ch) store.lastAction = `管径调整为 Ø${ch.diameter.toFixed(1)}mm`;
      }
    }
    this.drag = null;
    this.snapTargetId = null;
    this.snapRing.visible = false;
    this.controls.enabled = true;
  };

  // 供外部（按钮）使用
  focusAll(): void {
    const box = new THREE.Box3();
    box.expandByObject(this.gatingGroup);
    box.expandByObject(this.castingHolder);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.set(center.x + 520, center.y + 420, center.z + 620);
  }

  /** 调试/外部读取：当前热节 */
  getHotspots(): HotSpot[] {
    return this.casting?.hotspots ?? [];
  }
}

function makeLabel(className: string, text: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = `scene-label ${className}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

/** 判断当前指针相对基准点是向外（远离）还是向内（靠近）运动 */
function movingOutward(point: THREE.Vector3, drag: DragState): boolean {
  const distNow = point.clone().sub(drag.startPoint).lengthSq();
  const distLast = (drag.lastPoint ?? drag.startPoint).clone().sub(drag.startPoint).lengthSq();
  return distNow >= distLast;
}
