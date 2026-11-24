import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { DETACH_OFFSET, FLOOR_COLORS } from './store.js';
import { manifoldToGeometry } from './geometry.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpNormal = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();

function projectionRange(bbox, normal) {
  let min = 0;
  let max = 0;
  for (const axis of ['x', 'y', 'z']) {
    const n = normal[axis];
    const lo = bbox.min[axis];
    const hi = bbox.max[axis];
    if (n >= 0) {
      min += n * lo;
      max += n * hi;
    } else {
      min += n * hi;
      max += n * lo;
    }
  }
  return { min, max };
}

export class SceneController {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.disposed = false;

    this.assets = null;
    this.views = [];
    this.currentDoc = null;
    this.selectedId = null;
    this.transformMode = 'translate';
    this.isTransformDragging = false;

    this.sectionRaf = 0;
    this.lastCutKey = '';
    this.isSectionDragging = false;
    this.sectionPointerId = null;
    this.dragPlane = new THREE.Plane();

    this._initRenderer();
    this._initScene();
    this._initSandbox();
    this._initSectionHelper();
    this._initTransformControls();
    this._initPointerEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop(() => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _initRenderer() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.className = 'scene-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 300);
    this.camera.position.set(17, 14, 20);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e8eef6');
    this.scene.fog = new THREE.Fog('#e8eef6', 48, 95);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 6.4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    const hemi = new THREE.HemisphereLight('#ffffff', '#8da2b8', 1.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff4df', 2.35);
    sun.position.set(13, 24, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.00018;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight('#b9d7ff', 0.65);
    fill.position.set(-14, 10, -12);
    this.scene.add(fill);

    this.floorRoot = new THREE.Group();
    this.floorRoot.name = 'floor-root';
    this.scene.add(this.floorRoot);
  }

  _initSandbox() {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.42, 17),
      new THREE.MeshStandardMaterial({ color: '#c99a61', roughness: 0.82, metalness: 0.02 })
    );
    base.position.y = -0.21;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(23.35, 16.35),
      new THREE.MeshStandardMaterial({ color: '#f0e2c7', roughness: 0.9 })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.006;
    top.receiveShadow = true;
    this.scene.add(top);

    const grid = new THREE.GridHelper(23, 23, '#b89b72', '#d2bd98');
    grid.position.y = 0.014;
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    grid.material.depthWrite = false;
    this.scene.add(grid);

    const baseEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(base.geometry),
      new THREE.LineBasicMaterial({ color: '#8b6237', transparent: true, opacity: 0.45 })
    );
    baseEdges.position.copy(base.position);
    this.scene.add(baseEdges);
  }

  _initSectionHelper() {
    this.sectionGroup = new THREE.Group();
    this.sectionGroup.name = 'section-plane-helper';
    this.scene.add(this.sectionGroup);

    this.sectionPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshBasicMaterial({
        color: '#0284c7',
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.sectionPlane.renderOrder = 4;
    this.sectionGroup.add(this.sectionPlane);

    this.sectionFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(20, 20)),
      new THREE.LineBasicMaterial({
        color: '#0369a1',
        transparent: true,
        opacity: 0.95,
        depthTest: false
      })
    );
    this.sectionFrame.renderOrder = 20;
    this.sectionGroup.add(this.sectionFrame);

    this.sectionArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      3.4,
      0x0369a1,
      0.58,
      0.34
    );
    this.scene.add(this.sectionArrow);

    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 28, 18),
      new THREE.MeshStandardMaterial({
        color: '#0ea5e9',
        emissive: '#075985',
        emissiveIntensity: 0.55,
        roughness: 0.28
      })
    );
    this.handle.userData.sectionHandle = true;
    this.scene.add(this.handle);

    this.hitHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 16, 10),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false
      })
    );
    this.hitHandle.userData.sectionHandle = true;
    this.scene.add(this.hitHandle);
  }

  _initTransformControls() {
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.82);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);

    this.transform.addEventListener('dragging-changed', (event) => {
      this.isTransformDragging = Boolean(event.value);
      this.controls.enabled = !event.value;

      if (event.value) {
        this.handlers.onTransformStart?.();
      } else {
        const view = this.getSelectedView();
        if (view) {
          this._clampScale(view.inner);
          this.handlers.onTransformEnd?.(view.id, this.readTransform(view.inner));
        }
        this.selectionHelper?.update?.();
      }
    });

    this.transform.addEventListener('objectChange', () => {
      const view = this.getSelectedView();
      if (!view) return;
      this._clampScale(view.inner);
      this.handlers.onTransformPreview?.(view.id, this.readTransform(view.inner));
      this.selectionHelper?.update?.();
      this.scheduleSection();
    });
  }

  _initPointerEvents() {
    this.onWindowPointerDown = this._onWindowPointerDown.bind(this);
    this.onWindowPointerMove = this._onWindowPointerMove.bind(this);
    this.onWindowPointerUp = this._onWindowPointerUp.bind(this);
    this.onCanvasPointerDown = this._onCanvasPointerDown.bind(this);
    this.onCanvasClick = this._onCanvasClick.bind(this);

    window.addEventListener('pointerdown', this.onWindowPointerDown, true);
    window.addEventListener('pointermove', this.onWindowPointerMove, true);
    window.addEventListener('pointerup', this.onWindowPointerUp, true);
    window.addEventListener('pointercancel', this.onWindowPointerUp, true);
    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
  }

  _setPointerFromEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  _onWindowPointerDown(event) {
    if (this.disposed || event.button !== 0) return;
    if (event.target !== this.renderer.domElement) return;

    this._setPointerFromEvent(event);
    if (!this.handle || this.handle.visible === false) return;
    const handleHits = this.raycaster.intersectObjects([this.handle, this.hitHandle], false);
    if (!handleHits.length) return;

    event.preventDefault();
    event.stopPropagation();

    this.isSectionDragging = true;
    this.sectionPointerId = event.pointerId;
    this.controls.enabled = false;
    this.transform.enabled = false;

    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const section = this.currentDoc?.section;
    const normal = section
      ? new THREE.Vector3(...section.normal).normalize()
      : new THREE.Vector3(0, 1, 0);
    const center = normal.clone().multiplyScalar(section?.distance ?? 0);
    this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, center);

    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }
    this.handlers.onSectionStart?.();
  }

  _onWindowPointerMove(event) {
    if (!this.isSectionDragging) return;
    event.preventDefault();

    this._setPointerFromEvent(event);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, tmpPoint)) return;

    const section = this.currentDoc?.section;
    if (!section) return;

    const normal = tmpNormal.set(...section.normal).normalize();
    let distance = tmpPoint.dot(normal);
    distance = THREE.MathUtils.clamp(distance, -26, 36);
    this.handlers.onSectionPreview?.({ distance: Number(distance.toFixed(3)) });
  }

  _onWindowPointerUp(event) {
    if (!this.isSectionDragging) return;
    this.isSectionDragging = false;
    this.sectionPointerId = null;
    this.controls.enabled = true;
    this.transform.enabled = true;

    try {
      if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore.
    }
    this.handlers.onSectionEnd?.();
  }

  _onCanvasPointerDown(event) {
    this.downClientX = event.clientX;
    this.downClientY = event.clientY;
  }

  _onCanvasClick(event) {
    if (this.isSectionDragging || this.isTransformDragging) return;
    const moved = Math.hypot(
      event.clientX - (this.downClientX ?? event.clientX),
      event.clientY - (this.downClientY ?? event.clientY)
    );
    if (moved > 6) return;

    this._setPointerFromEvent(event);
    const pickObjects = this.views.flatMap((view) => {
      if (!view.outer.visible) return [];
      const objects = [];
      if (view.mesh.visible) objects.push(view.mesh);
      if (view.capMesh.visible) objects.push(view.capMesh);
      return objects;
    });

    const hits = this.raycaster.intersectObjects(pickObjects, false);
    const hit = hits.find((item) => item.object?.userData?.floorId);
    this.handlers.onSelectFloor?.(hit ? hit.object.userData.floorId : null);
  }

  setFloorAssets(assets) {
    this._clearViews();
    this.assets = assets;
    if (!assets) return;

    const sharedEdgeMaterial = new THREE.LineBasicMaterial({
      color: '#263445',
      transparent: true,
      opacity: 0.34
    });
    this.edgeMaterial = sharedEdgeMaterial;

    this.capMaterial = new THREE.MeshStandardMaterial({
      color: '#ff8a1f',
      emissive: '#7c2d12',
      emissiveIntensity: 0.28,
      roughness: 0.36,
      metalness: 0.04,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    this.capEdgeMaterial = new THREE.LineBasicMaterial({
      color: '#7c2d12',
      transparent: true,
      opacity: 0.72,
      depthTest: false
    });

    this.views = assets.floors.map((asset) => this._createFloorView(asset));
    for (const view of this.views) this.floorRoot.add(view.outer);

    this.lastCutKey = '';
    this.attachSelection();
    if (this.currentDoc) this.syncDoc(this.currentDoc);
  }

  _createFloorView(asset) {
    const color = FLOOR_COLORS[asset.index % FLOOR_COLORS.length];
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.69,
      metalness: 0.045,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });

    const outer = new THREE.Group();
    outer.name = `floor-outer-${asset.id}`;
    outer.userData.floorId = asset.id;

    // Geometry is in building-world coordinates. These two rest transforms put
    // the user-controlled group's origin at the floor bbox center, so rotate
    // and scale Gizmos pivot about the floor instead of the sandbox origin.
    const center = asset.bbox.getCenter(new THREE.Vector3());
    const centerRest = new THREE.Group();
    centerRest.position.copy(center);

    const inner = new THREE.Group();
    inner.name = `floor-user-transform-${asset.id}`;
    inner.userData.floorId = asset.id;

    const offset = new THREE.Group();
    offset.position.set(-center.x, -center.y, -center.z);
    offset.name = `floor-centered-offset-${asset.id}`;

    outer.add(centerRest);
    centerRest.add(inner);
    inner.add(offset);

    const mesh = new THREE.Mesh(asset.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.floorId = asset.id;
    offset.add(mesh);

    const baseEdgeGeometry = new THREE.EdgesGeometry(asset.geometry, 24);
    const bodyEdges = new THREE.LineSegments(baseEdgeGeometry, this.edgeMaterial);
    bodyEdges.renderOrder = 3;
    offset.add(bodyEdges);

    const capMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.capMaterial);
    capMesh.visible = false;
    capMesh.receiveShadow = true;
    capMesh.renderOrder = 8;
    capMesh.userData.floorId = asset.id;
    offset.add(capMesh);

    const capEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.capEdgeMaterial);
    capEdges.renderOrder = 21;
    capMesh.add(capEdges);

    return {
      id: asset.id,
      index: asset.index,
      asset,
      outer,
      centerRest,
      inner,
      offset,
      mesh,
      material,
      bodyEdges,
      baseEdgeGeometry,
      capMesh,
      capEdges,
      clipDisposables: []
    };
  }

  syncDoc(doc) {
    this.currentDoc = doc;
    if (!this.assets || !doc) return;

    for (const floorState of doc.floors) {
      const view = this.views[floorState.index] ?? this.views.find((v) => v.id === floorState.id);
      if (!view) continue;

      view.id = floorState.id;
      view.asset.id = floorState.id;
      view.outer.userData.floorId = floorState.id;
      view.inner.userData.floorId = floorState.id;
      view.mesh.userData.floorId = floorState.id;

      view.outer.visible = floorState.visible !== false;
      const detach = floorState.detached ? DETACH_OFFSET : [0, 0, 0];
      view.outer.position.set(detach[0], detach[1], detach[2]);

      const isBeingTransformed =
        this.isTransformDragging && this.transform.object === view.inner;

      if (!isBeingTransformed) {
        view.inner.position.fromArray(floorState.position ?? [0, 0, 0]);
        const rotation = floorState.rotation ?? [0, 0, 0];
        view.inner.rotation.set(
          THREE.MathUtils.degToRad(rotation[0] || 0),
          THREE.MathUtils.degToRad(rotation[1] || 0),
          THREE.MathUtils.degToRad(rotation[2] || 0)
        );
        view.inner.scale.fromArray(floorState.scale ?? [1, 1, 1]);
        this._clampScale(view.inner, false);
      }
    }

    this.floorRoot.updateMatrixWorld(true);
    this.updateSelectionAfterSync();
    this.updateSectionHelper(doc.section);
    this.scheduleSection();
  }

  setSelection(selectedId, mode = this.transformMode) {
    this.selectedId = selectedId;
    this.transformMode = mode;
    this.attachSelection();
  }

  setTransformMode(mode) {
    this.transformMode = mode;
    this.transform?.setMode(mode);
  }

  getSelectedView() {
    return this.views.find((view) => view.id === this.selectedId) ?? null;
  }

  _createSelectionHelper(object) {
    const helper = new THREE.BoxHelper(object, 0x1d4ed8);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.95;
    helper.renderOrder = 30;
    this.scene.add(helper);
    return helper;
  }

  attachSelection() {
    if (!this.transform) return;
    const view = this.getSelectedView();

    if (!view || view.outer.visible === false) {
      this.transform.detach();
      if (this.selectionHelper) this.selectionHelper.visible = false;
      return;
    }

    if (this.transform.object !== view.inner) {
      this.transform.attach(view.inner);
    }
    this.transform.setMode(this.transformMode);

    if (!this.selectionHelper) {
      this.selectionHelper = this._createSelectionHelper(view.inner);
    } else {
      this.selectionHelper.visible = true;
      this.selectionHelper.setFromObject(view.inner);
    }
    this.selectionHelper.update();
  }

  updateSelectionAfterSync() {
    const view = this.getSelectedView();
    if (!view || view.outer.visible === false) {
      if (this.transform?.object) this.transform.detach();
      if (this.selectionHelper) this.selectionHelper.visible = false;
      return;
    }

    if (this.transform?.object !== view.inner) {
      this.transform.attach(view.inner);
      this.transform.setMode(this.transformMode);
    }
    if (!this.selectionHelper) {
      this.selectionHelper = this._createSelectionHelper(view.inner);
    }
    this.selectionHelper.visible = true;
    this.selectionHelper.update();
  }

  readTransform(object) {
    return {
      position: [
        Number(object.position.x.toFixed(3)),
        Number(object.position.y.toFixed(3)),
        Number(object.position.z.toFixed(3))
      ],
      rotation: [
        Number(THREE.MathUtils.radToDeg(object.rotation.x).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(object.rotation.y).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(object.rotation.z).toFixed(2))
      ],
      scale: [
        Number(object.scale.x.toFixed(3)),
        Number(object.scale.y.toFixed(3)),
        Number(object.scale.z.toFixed(3))
      ]
    };
  }

  _clampScale(object, mutate = true) {
    const min = 0.08;
    let changed = false;
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(object.scale[axis]) || object.scale[axis] < min) {
        if (mutate) object.scale[axis] = min;
        changed = true;
      }
    }
    return changed;
  }

  updateSectionHelper(section) {
    if (!section) return;
    const normal = new THREE.Vector3(...(section.normal ?? [0, 1, 0]));
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();

    const distance = Number(section.distance) || 0;
    const center = normal.clone().multiplyScalar(distance);
    const visible = section.enabled !== false && section.helper !== false;

    this.sectionGroup.visible = visible;
    this.sectionArrow.visible = visible;
    this.handle.visible = visible;
    this.hitHandle.visible = visible;

    this.sectionPlane.position.copy(center);
    this.sectionPlane.quaternion.setFromUnitVectors(Z_AXIS, normal);
    this.sectionFrame.position.copy(center);
    this.sectionFrame.quaternion.setFromUnitVectors(Z_AXIS, normal);

    this.sectionArrow.position.copy(center);
    this.sectionArrow.setDirection(normal);
    this.sectionArrow.setLength(3.3, 0.58, 0.32);

    const handlePosition = center.clone().addScaledVector(normal, 3.3);
    this.handle.position.copy(handlePosition);
    this.hitHandle.position.copy(handlePosition);
  }

  scheduleSection() {
    if (this.sectionRaf || this.disposed) return;
    this.sectionRaf = requestAnimationFrame(() => {
      this.sectionRaf = 0;
      this.updateSection();
    });
  }

  updateSection(section = this.currentDoc?.section) {
    if (!this.assets || !section) return [];
    this.updateSectionHelper(section);

    const cutIds = [];
    const normalWorld = new THREE.Vector3(...(section.normal ?? [0, 1, 0]));
    if (normalWorld.lengthSq() < 1e-8) normalWorld.set(0, 1, 0);
    normalWorld.normalize();

    if (section.enabled === false) {
      for (const view of this.views) this.resetViewGeometry(view);
      this._afterSectionGeometryChange();
      this._emitCutIds([]);
      return [];
    }

    for (const view of this.views) {
      const floorState = this.currentDoc?.floors?.[view.index];
      if (floorState?.visible === false) {
        this.resetViewGeometry(view);
        continue;
      }

      view.mesh.updateWorldMatrix(true, false);
      const matrixWorld = view.mesh.matrixWorld;

      // World plane: n_w · p_w = d. Substitute p_w = A p_l + t.
      // Local plane: (A^T n_w) · p_l = d - n_w·t.
      const linear = new THREE.Matrix3().setFromMatrix4(matrixWorld);
      const coefficient = normalWorld.clone().applyMatrix3(linear.transpose());
      const coefficientLength = coefficient.length();

      if (coefficientLength < 1e-7) {
        this.resetViewGeometry(view);
        continue;
      }

      const localNormal = coefficient.clone().multiplyScalar(1 / coefficientLength);
      const worldPosition = new THREE.Vector3();
      view.mesh.getWorldPosition(worldPosition);
      const localDistance =
        (section.distance - normalWorld.dot(worldPosition)) / coefficientLength;

      const range = projectionRange(view.asset.bbox, localNormal);
      const eps = 1e-4;

      if (localDistance <= range.min + eps) {
        this.showEmptyView(view);
        continue;
      }

      if (localDistance >= range.max - eps) {
        this.resetViewGeometry(view);
        continue;
      }

      let positive = null;
      let negative = null;
      let capManifold = null;
      let thinCapManifold = null;

      try {
        [positive, negative] = view.asset.manifold.splitByPlane(
          localNormal.toArray(),
          localDistance
        );

        if (!negative || negative.isEmpty() || !positive || positive.isEmpty()) {
          negative?.delete?.();
          positive?.delete?.();
          this.resetViewGeometry(view);
          continue;
        }

        const bodyGeometry = manifoldToGeometry(negative);

        // Constant world-space cap thickness converted to local plane offset.
        const epsilonLocal = 0.004 / coefficientLength;
        const thicknessLocal = Math.max(0.014, section.thickness ?? 0.09) / coefficientLength;

        thinCapManifold = positive.trimByPlane(
          localNormal.toArray(),
          localDistance + epsilonLocal
        );
        capManifold = thinCapManifold.trimByPlane(
          [-localNormal.x, -localNormal.y, -localNormal.z],
          -(localDistance + thicknessLocal)
        );

        if (capManifold.isEmpty()) {
          capManifold.delete?.();
          capManifold = positive;
        }

        const capGeometry = manifoldToGeometry(capManifold);
        const bodyEdgesGeometry = new THREE.EdgesGeometry(bodyGeometry, 24);
        const capEdgesGeometry = new THREE.EdgesGeometry(capGeometry, 18);

        this.setClipGeometries(view, {
          bodyGeometry,
          capGeometry,
          bodyEdgesGeometry,
          capEdgesGeometry
        });
        cutIds.push(view.id);

        negative.delete?.();
        positive.delete?.();
        thinCapManifold.delete?.();
        if (capManifold !== positive) capManifold.delete?.();
      } catch (error) {
        console.error('Manifold section failed for floor', view.id, error);
        try {
          negative?.delete?.();
          positive?.delete?.();
          thinCapManifold?.delete?.();
          capManifold?.delete?.();
        } catch {
          // Ignore secondary WASM cleanup errors.
        }
        this.resetViewGeometry(view);
      }
    }

    this._afterSectionGeometryChange();
    this._emitCutIds(cutIds);
    return cutIds;
  }

  _emitCutIds(ids) {
    const key = ids.join('|');
    if (key === this.lastCutKey) return;
    this.lastCutKey = key;
    this.handlers.onCutChange?.(ids);
  }

  _afterSectionGeometryChange() {
    this.selectionHelper?.update?.();
  }

  clearClipGeometries(view) {
    for (const geometry of view.clipDisposables) {
      try {
        geometry.dispose();
      } catch {
        // Already disposed.
      }
    }
    view.clipDisposables = [];
  }

  setClipGeometries(view, geometries) {
    this.clearClipGeometries(view);

    view.mesh.visible = true;
    view.bodyEdges.visible = true;
    view.capMesh.visible = true;

    view.mesh.geometry = geometries.bodyGeometry;
    view.bodyEdges.geometry = geometries.bodyEdgesGeometry;
    view.capMesh.geometry = geometries.capGeometry;
    view.capEdges.geometry = geometries.capEdgesGeometry;

    view.clipDisposables = [
      geometries.bodyGeometry,
      geometries.capGeometry,
      geometries.bodyEdgesGeometry,
      geometries.capEdgesGeometry
    ];
  }

  resetViewGeometry(view) {
    this.clearClipGeometries(view);
    view.mesh.visible = true;
    view.bodyEdges.visible = true;
    view.capMesh.visible = false;
    view.mesh.geometry = view.asset.geometry;
    view.bodyEdges.geometry = view.baseEdgeGeometry;
  }

  showEmptyView(view) {
    this.resetViewGeometry(view);
    view.mesh.visible = false;
    view.bodyEdges.visible = false;
    view.capMesh.visible = false;
  }

  frameAssets(assets = this.assets) {
    if (!assets?.bounds) return;
    const min = new THREE.Vector3(...assets.bounds.min);
    const max = new THREE.Vector3(...assets.bounds.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min);
    const maxDimension = Math.max(size.x, size.y * 1.1, size.z);
    const distance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.35;

    this.controls.target.set(center.x, center.y * 0.72, center.z);
    this.camera.position.set(
      center.x + distance * 0.72,
      center.y + distance * 0.52,
      center.z + distance * 0.92
    );
    this.camera.near = 0.1;
    this.camera.far = Math.max(200, distance * 8);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  _clearViews() {
    if (this.transform) this.transform.detach();

    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      this.selectionHelper.material.dispose();
      this.selectionHelper = null;
    }

    for (const view of this.views) {
      this.clearClipGeometries(view);
      view.baseEdgeGeometry.dispose();
      view.material.dispose();
      this.floorRoot.remove(view.outer);
    }
    this.views = [];

    this.edgeMaterial?.dispose?.();
    this.capMaterial?.dispose?.();
    this.capEdgeMaterial?.dispose?.();
  }

  dispose() {
    this.disposed = true;
    if (this.sectionRaf) cancelAnimationFrame(this.sectionRaf);
    this.resizeObserver?.disconnect();

    window.removeEventListener('pointerdown', this.onWindowPointerDown, true);
    window.removeEventListener('pointermove', this.onWindowPointerMove, true);
    window.removeEventListener('pointerup', this.onWindowPointerUp, true);
    window.removeEventListener('pointercancel', this.onWindowPointerUp, true);
    this.renderer?.domElement?.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.renderer?.domElement?.removeEventListener('click', this.onCanvasClick);

    window.removeEventListener('pointerdown', this.onWindowPointerDown, true);
    window.removeEventListener('pointermove', this.onWindowPointerMove, true);
    window.removeEventListener('pointerup', this.onWindowPointerUp, true);

    this._clearViews();
    this.controls?.dispose?.();
    this.transform?.dispose?.();

    this.scene?.traverse((object) => {
      if (object.geometry) object.geometry.dispose?.();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose?.();
      }
    });

    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove();
  }
}
