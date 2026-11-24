import * as THREE from 'three';
import ManifoldModule from 'manifold-3d';
// Vite emits the WASM as a hashed static asset and gives us a URL.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

let manifoldApiPromise = null;

export function initManifold() {
  if (!manifoldApiPromise) {
    manifoldApiPromise = ManifoldModule({
      locateFile: () => manifoldWasmUrl
    }).then((api) => {
      api.setup?.();
      api.Manifold.setCircularSegments?.(24);
      return api;
    });
  }
  return manifoldApiPromise;
}

export const BUILDING_PRESETS = [
  {
    id: 'tower',
    name: '退台塔楼',
    short: '塔楼',
    description: '裙房、高层塔身与顶部机房组成的经典多层塔楼。',
    defaultFloors: 7
  },
  {
    id: 'terraces',
    name: '阶梯台地',
    short: '台地',
    description: '三次收分的退台体块，适合观察不同面积楼层的切分。',
    defaultFloors: 6
  },
  {
    id: 'corner',
    name: 'L 形街角楼',
    short: 'L 形',
    description: '两翼围合出转角平面，任意方向剖切时截面更有辨识度。',
    defaultFloors: 5
  }
];

export function getPreset(id) {
  return BUILDING_PRESETS.find((p) => p.id === id) ?? BUILDING_PRESETS[0];
}

function box(api, width, height, depth, x = 0, bottom = 0, z = 0) {
  return api.Manifold.cube([width, height, depth], true)
    .translate([x, bottom + height / 2, z]);
}

function union(api, items) {
  return api.Manifold.union(items.filter(Boolean));
}

export function createBuildingManifold(api, buildingId) {
  if (buildingId === 'terraces') {
    return union(api, [
      box(api, 11.2, 4.6, 8.2, 0, 0, 0),
      box(api, 8.7, 4.6, 6.4, 0, 4.6, -0.15),
      box(api, 6.2, 4.6, 4.7, 0, 9.2, -0.35),
      box(api, 6.7, 0.34, 5.1, 0, 13.8, -0.35)
    ]);
  }

  if (buildingId === 'corner') {
    return union(api, [
      // West wing, north-south.
      box(api, 4.3, 14.2, 10.2, -3.15, 0, 0),
      // East/south wing overlaps the first wing to form a connected L.
      box(api, 9.8, 12.4, 4.3, 0.35, 0, 2.95),
      box(api, 4.8, 0.38, 10.7, -3.15, 14.2, 0),
      box(api, 3.1, 2.0, 3.4, -3.15, 14.58, -2.2)
    ]);
  }

  // tower
  return union(api, [
    box(api, 10.6, 3.35, 7.8, 0, 0, 0),
    box(api, 7.5, 12.55, 5.9, 0, 3.35, 0),
    box(api, 8.1, 0.42, 6.5, 0, 15.9, 0),
    box(api, 4.2, 2.05, 3.3, 0.8, 16.32, -0.55)
  ]);
}

/**
 * Convert a Manifold mesh to a flat-shaded Three BufferGeometry.
 * The returned geometry is independent of WASM memory.
 */
export function manifoldToGeometry(manifold) {
  const wasmMesh = manifold.getMesh();
  const numProp = wasmMesh.numProp || 3;
  const vertexCount = Math.floor(wasmMesh.vertProperties.length / numProp);

  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * numProp;
    positions[i * 3 + 0] = wasmMesh.vertProperties[offset + 0];
    positions[i * 3 + 1] = wasmMesh.vertProperties[offset + 1];
    positions[i * 3 + 2] = wasmMesh.vertProperties[offset + 2];
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  indexed.setIndex(new THREE.BufferAttribute(wasmMesh.triVerts.slice(), 1));

  // Non-indexed + recomputed normals gives crisp architectural facets.
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Split the selected massing model by equal world-height intervals.
 * Manifold intersection creates a closed solid for every floor, including
 * the horizontal bottom slab cap.
 */
export function splitBuildingIntoFloors(api, buildingId, floorCount) {
  const whole = createBuildingManifold(api, buildingId);
  const bounds = whole.boundingBox();
  const min = new THREE.Vector3(...bounds.min);
  const max = new THREE.Vector3(...bounds.max);
  const size = max.clone().sub(min);
  const center = min.clone().add(max).multiplyScalar(0.5);

  const count = Math.max(1, Math.min(30, Math.round(floorCount) || 1));
  const interval = size.y / count;
  // A tiny construction seam prevents coincident top/bottom faces from
  // z-fighting while keeping every layer in its original stack position.
  const seam = Math.min(0.055, interval * 0.09);

  const floors = [];

  for (let i = 0; i < count; i++) {
    const y0 = min.y + i * interval;
    const y1 = min.y + (i + 1) * interval;
    const bottom = y0;
    const top = i === count - 1 ? y1 : Math.max(bottom + 0.02, y1 - seam);
    const height = top - bottom;

    const cutter = api.Manifold.cube(
      [size.x + 4, height, size.z + 4],
      true
    ).translate([center.x, (bottom + top) / 2, center.z]);

    const floorManifold = api.Manifold.intersection(whole, cutter);
    cutter.delete?.();

    const geometry = manifoldToGeometry(floorManifold);
    floors.push({
      id: `floor-${i + 1}`,
      index: i,
      manifold: floorManifold,
      geometry,
      bbox: geometry.boundingBox.clone()
    });
  }

  whole.delete?.();

  return {
    key: `${buildingId}:${count}`,
    buildingId,
    floorCount: count,
    floors,
    bounds: { min: min.toArray(), max: max.toArray(), size: size.toArray() }
  };
}

export function disposeBuildingAssets(assets) {
  if (!assets) return;
  for (const floor of assets.floors ?? []) {
    try {
      floor.manifold?.delete?.();
    } catch {
      // WASM object may already be torn down.
    }
    floor.geometry?.dispose?.();
  }
}
