import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Doc, Selection, Vec3 } from '../state/types';
import { ROOM, WALL_H, lightDirection, type LightPathResult } from './transmission';
import { kelvinToRGB } from './kelvin';

export interface SceneCallbacks {
  onSelect: (sel: Selection) => void;
  /** 拖拽手柄开始时调用(记录撤销历史) */
  onDragStart: () => void;
  onIceTransform: (id: string, position: Vec3, rotationY: number) => void;
  onLightMove: (id: string, position: Vec3) => void;
  onGroupTransform: (updates: Array<{ id: string; position: Vec3; azimuth: number }>) => void;
  /** 查询组质心与成员(拖拽组时建立快照) */
  getGroupState: (
    groupId: string,
  ) => { centroid: Vec3; members: Array<{ id: string; position: Vec3; azimuth: number }> } | null;
}

interface IceEntry {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshPhysicalMaterial>;
}

interface LightEntry {
  group: THREE.Group;
  bulb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  dirGroup: THREE.Group;
}

const SOFTNESS_LEVELS = [0.06, 0.18, 0.35, 0.55, 0.8];

const spotVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const spotFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSoft;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    float feather = max(uSoft, 0.02);
    float edge = 1.0 - smoothstep(1.0 - feather, 1.0, d);
    float core = exp(-d * d * 4.0);
    float a = core * edge * clamp(uIntensity, 0.0, 1.2);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private controls: TransformControls;
  private raycaster = new THREE.Raycaster();

  private iceEntries = new Map<string, IceEntry>();
  private lightEntries = new Map<string, LightEntry>();
  private pathLines = new Map<string, THREE.Line>();
  private spotMeshes = new Map<string, THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>>();
  private proxy = new THREE.Object3D();

  private selection: Selection = null;
  private mode: 'translate' | 'rotate' = 'translate';
  private groupDragSnapshot: {
    centroid: THREE.Vector3;
    proxyStart: THREE.Vector3;
    members: Array<{ id: string; position: THREE.Vector3; azimuth: number }>;
  } | null = null;

  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private unitBoxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private spotGeometry = new THREE.CircleGeometry(1, 48);

  constructor(
    private container: HTMLElement,
    private cb: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(11, 8, 13);

    this.scene.background = new THREE.Color(0x0a0f1a);
    this.scene.fog = new THREE.Fog(0x0a0f1a, 30, 70);

    this.buildEnvironment();

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1.2, 0);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;

    this.controls = new TransformControls(this.camera, this.renderer.domElement);
    this.controls.setSize(0.8);
    this.scene.add(this.controls);
    this.controls.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) {
        this.cb.onDragStart();
        this.captureGroupSnapshot();
      } else {
        this.groupDragSnapshot = null;
      }
    });
    this.controls.addEventListener('objectChange', () => this.onObjectChange());

    // 拾取:pointerup 且位移很小视为点击
    let downX = 0;
    let downY = 0;
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      if (this.controls.dragging) return;
      this.pick(e);
    });

    const resize = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    new ResizeObserver(resize).observe(this.container);
    resize();

    this.renderer.setAnimationLoop(() => {
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /* ---------------- 环境 ---------------- */

  private buildEnvironment() {
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
    const dirLight = new THREE.DirectionalLight(0xdde8ff, 1.2);
    dirLight.position.set(8, 14, 6);
    this.scene.add(dirLight);
    const hemi = new THREE.HemisphereLight(0x334466, 0x0a0c12, 0.5);
    this.scene.add(hemi);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM * 2, ROOM * 2),
      new THREE.MeshStandardMaterial({ color: 0x10151f, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(ROOM * 2, ROOM * 2, 0x2a3a55, 0x1a2436);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = 0.01;
    this.scene.add(grid);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x161d2c,
      roughness: 0.95,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const wallGeo = new THREE.PlaneGeometry(ROOM * 2, WALL_H);
    const walls: Array<[number, number, number, number]> = [
      [0, WALL_H / 2, -ROOM, 0],
      [0, WALL_H / 2, ROOM, Math.PI],
      [-ROOM, WALL_H / 2, 0, Math.PI / 2],
      [ROOM, WALL_H / 2, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of walls) {
      const w = new THREE.Mesh(wallGeo, wallMat);
      w.position.set(x, y, z);
      w.rotation.y = ry;
      this.scene.add(w);
    }
  }

  /* ---------------- 网格创建 ---------------- */

  private makeIceEntry(id: string): IceEntry {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe3ff,
      transmission: 0.88,
      thickness: 1,
      roughness: 0.3,
      ior: 1.31,
      transparent: true,
    });
    const mesh = new THREE.Mesh(this.unitBox, mat);
    const edges = new THREE.LineSegments(
      this.unitBoxEdges,
      new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35 }),
    );
    mesh.add(edges);
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.sel = { kind: 'ice', id };
    this.scene.add(group);
    return { group, mesh };
  }

  private makeLightEntry(id: string): LightEntry {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    const dirGroup = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(0.07, 0.3, 12);
    coneGeo.rotateX(Math.PI / 2); // 锥尖朝 +Z
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    cone.position.z = 0.32;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    );
    shaft.geometry.rotateX(Math.PI / 2);
    shaft.position.z = 0.18;
    dirGroup.add(cone, shaft);
    const group = new THREE.Group();
    group.add(bulb, dirGroup);
    group.userData.sel = { kind: 'light', id };
    this.scene.add(group);
    return { group, bulb, dirGroup };
  }

  /* ---------------- 同步:文档 → 场景 ---------------- */

  syncDoc(doc: Doc) {
    // 冰体
    const iceSeen = new Set<string>();
    for (const b of doc.iceBlocks) {
      iceSeen.add(b.id);
      let e = this.iceEntries.get(b.id);
      if (!e) {
        e = this.makeIceEntry(b.id);
        this.iceEntries.set(b.id, e);
      }
      e.group.position.set(b.position[0], b.position[1], b.position[2]);
      e.group.rotation.y = b.rotationY;
      e.mesh.scale.set(b.size[0], b.size[1], b.size[2]);
      e.mesh.material.roughness = 0.08 + b.turbidity * 0.7;
      e.mesh.material.thickness = Math.max(0.2, b.size[2]);
      const selected = this.selection?.kind === 'ice' && this.selection.id === b.id;
      e.mesh.material.emissive.setHex(selected ? 0x1a4a7a : 0x000000);
    }
    for (const [id, e] of this.iceEntries) {
      if (!iceSeen.has(id)) {
        this.scene.remove(e.group);
        e.mesh.material.dispose();
        this.iceEntries.delete(id);
      }
    }

    // 灯
    const lightSeen = new Set<string>();
    for (const l of doc.lights) {
      lightSeen.add(l.id);
      let e = this.lightEntries.get(l.id);
      if (!e) {
        e = this.makeLightEntry(l.id);
        this.lightEntries.set(l.id, e);
      }
      e.group.position.set(l.position[0], l.position[1], l.position[2]);
      const [r, g, b2] = kelvinToRGB(l.kelvin);
      e.bulb.material.color.setRGB(r, g, b2);
      const dir = lightDirection(l);
      e.dirGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const selected = this.selection?.kind === 'light' && this.selection.id === l.id;
      e.bulb.scale.setScalar(selected ? 1.5 : 1);
    }
    for (const [id, e] of this.lightEntries) {
      if (!lightSeen.has(id)) {
        this.scene.remove(e.group);
        this.lightEntries.delete(id);
      }
    }

    // 组代理(非拖拽时跟随质心)
    if (this.selection?.kind === 'group' && !this.controls.dragging) {
      const gs = this.cb.getGroupState(this.selection.id);
      if (gs) {
        this.proxy.position.set(gs.centroid[0], gs.centroid[1], gs.centroid[2]);
        this.proxy.rotation.set(0, 0, 0);
      }
    }
  }

  /* ---------------- 同步:透射路径与光斑 ---------------- */

  syncPaths(results: LightPathResult[]) {
    const seen = new Set<string>();
    for (const r of results) {
      seen.add(r.lightId);
      const selected = this.selection?.kind === 'light' && this.selection.id === r.lightId;
      const [cr, cg, cb2] = kelvinToRGB(r.kelvin);

      // 透射折线
      let line = this.pathLines.get(r.lightId);
      if (!line) {
        line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ transparent: true }),
        );
        line.frustumCulled = false;
        this.scene.add(line);
        this.pathLines.set(r.lightId, line);
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(r.points);
      const mat = line.material as THREE.LineBasicMaterial;
      mat.color.setRGB(cr, cg, cb2);
      mat.opacity = selected ? 1 : 0.28;

      // 光斑
      let spotMesh = this.spotMeshes.get(r.lightId);
      if (r.spot) {
        if (!spotMesh) {
          const material = new THREE.ShaderMaterial({
            vertexShader: spotVertexShader,
            fragmentShader: spotFragmentShader,
            uniforms: {
              uColor: { value: new THREE.Color() },
              uIntensity: { value: 0 },
              uSoft: { value: 0.3 },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          spotMesh = new THREE.Mesh(this.spotGeometry, material);
          spotMesh.renderOrder = 5;
          this.scene.add(spotMesh);
          this.spotMeshes.set(r.lightId, spotMesh);
        }
        const s = r.spot;
        const zAxis = s.normal.clone().normalize();
        let tangent = r.dir.clone().projectOnPlane(zAxis);
        if (tangent.lengthSq() < 1e-6) {
          tangent = new THREE.Vector3(1, 0, 0).projectOnPlane(zAxis);
        }
        tangent.normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, tangent);
        const m = new THREE.Matrix4().makeBasis(tangent, yAxis, zAxis);
        spotMesh.quaternion.setFromRotationMatrix(m);
        spotMesh.position.copy(s.point).addScaledVector(zAxis, 0.02);
        const cos = Math.max(0.35, Math.abs(r.dir.dot(zAxis)));
        spotMesh.scale.set(s.radius / cos, s.radius, 1);
        const u = spotMesh.material.uniforms;
        (u.uColor.value as THREE.Color).setRGB(cr, cg, cb2);
        u.uIntensity.value = Math.min(1.2, s.intensity * 0.4);
        u.uSoft.value = SOFTNESS_LEVELS[Math.min(4, Math.max(0, Math.round(r.softness)))];
        spotMesh.visible = true;
      } else if (spotMesh) {
        spotMesh.visible = false;
      }
    }
    for (const [id, line] of this.pathLines) {
      if (!seen.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.pathLines.delete(id);
      }
    }
    for (const [id, mesh] of this.spotMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.material.dispose();
        this.spotMeshes.delete(id);
      }
    }
  }

  /* ---------------- 选择 ---------------- */

  syncSelection(sel: Selection, mode: 'translate' | 'rotate') {
    // 拖拽过程中不重置手柄,避免打断手势
    if (this.controls.dragging) return;
    this.selection = sel;
    this.mode = mode;
    this.controls.detach();

    if (!sel) return;
    this.controls.setMode(mode);

    if (sel.kind === 'ice') {
      const e = this.iceEntries.get(sel.id);
      if (!e) return;
      // 旋转模式只允许绕 Y 轴
      this.controls.showX = mode === 'translate';
      this.controls.showZ = mode === 'translate';
      this.controls.showY = true;
      this.controls.attach(e.group);
    } else if (sel.kind === 'light') {
      const e = this.lightEntries.get(sel.id);
      if (!e) return;
      // 灯只支持平移,朝向由面板滑杆控制
      this.controls.setMode('translate');
      this.controls.showX = this.controls.showY = this.controls.showZ = true;
      this.controls.attach(e.group);
    } else {
      const gs = this.cb.getGroupState(sel.id);
      if (!gs) return;
      this.proxy.position.set(gs.centroid[0], gs.centroid[1], gs.centroid[2]);
      this.proxy.rotation.set(0, 0, 0);
      this.controls.showX = mode === 'translate';
      this.controls.showZ = mode === 'translate';
      this.controls.showY = true;
      this.controls.attach(this.proxy);
    }
  }

  /* ---------------- 交互 ---------------- */

  private captureGroupSnapshot() {
    this.groupDragSnapshot = null;
    if (this.selection?.kind !== 'group') return;
    const gs = this.cb.getGroupState(this.selection.id);
    if (!gs) return;
    this.groupDragSnapshot = {
      centroid: new THREE.Vector3(...gs.centroid),
      proxyStart: this.proxy.position.clone(),
      members: gs.members.map((m) => ({
        id: m.id,
        position: new THREE.Vector3(...m.position),
        azimuth: m.azimuth,
      })),
    };
  }

  private onObjectChange() {
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === 'ice') {
      const e = this.iceEntries.get(sel.id);
      if (!e) return;
      const p = e.group.position;
      this.cb.onIceTransform(sel.id, [p.x, p.y, p.z], e.group.rotation.y);
    } else if (sel.kind === 'light') {
      const e = this.lightEntries.get(sel.id);
      if (!e) return;
      const p = e.group.position;
      this.cb.onLightMove(sel.id, [p.x, Math.max(0.1, p.y), p.z]);
    } else if (this.groupDragSnapshot) {
      const snap = this.groupDragSnapshot;
      const dPos = this.proxy.position.clone().sub(snap.proxyStart);
      const dRot = this.proxy.rotation.y;
      const cos = Math.cos(dRot);
      const sin = Math.sin(dRot);
      const updates = snap.members.map((m) => {
        const dx = m.position.x - snap.centroid.x;
        const dz = m.position.z - snap.centroid.z;
        return {
          id: m.id,
          position: [
            snap.centroid.x + dx * cos + dz * sin + dPos.x,
            m.position.y + dPos.y,
            snap.centroid.z - dx * sin + dz * cos + dPos.z,
          ] as Vec3,
          azimuth: m.azimuth + (dRot * 180) / Math.PI,
        };
      });
      this.cb.onGroupTransform(updates);
    }
  }

  private pick(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const pickables: THREE.Object3D[] = [];
    for (const entry of this.iceEntries.values()) pickables.push(entry.group);
    for (const entry of this.lightEntries.values()) pickables.push(entry.group);
    const hits = this.raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData.sel) {
          this.cb.onSelect(obj.userData.sel as Selection);
          return;
        }
        obj = obj.parent;
      }
    }
    this.cb.onSelect(null);
  }
}
