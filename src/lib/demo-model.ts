// 内置示例化石:用 manifold 原生基本体+布尔运算构建的"菊石"实体
// 螺旋管(扫掠多段球并集形成弯曲实心管)+ 内部隔板,保证二维流形有效
// 输出与文件导入完全一致的三角网格,走相同的实体构建流程
import Module from 'manifold-3d/manifold';
import type { ManifoldToplevel, Manifold, Mat4 } from 'manifold-3d/manifold';

export interface DemoMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  name: string;
}

interface ManifoldModule extends ManifoldToplevel {}

let modulePromise: Promise<ManifoldModule> | null = null;
async function locateWasm(): Promise<string> {
  // 浏览器/Vite:?url 返回打包后的静态资源地址
  try {
    const mod = await import('manifold-3d/manifold.wasm?url');
    return mod.default;
  } catch {
    // Node/测试环境:回退到包内实际文件
    const { fileURLToPath } = await import('node:url');
    const { resolve } = await import('node:path');
    return resolve(fileURLToPath(import.meta.url), '../../../node_modules/manifold-3d/manifold.wasm');
  }
}
function getModule(): Promise<ManifoldModule> {
  if (!modulePromise) {
    modulePromise = locateWasm().then(url =>
      Module({ locateFile: () => url }).then(m => {
        m.setup();
        return m;
      })
    );
  }
  return modulePromise;
}

/** 螺旋中心线路径点 */
function spiralPoint(t: number): [number, number, number] {
  const turns = 2.6;
  const angle = t * turns * Math.PI * 2;
  const radius = 0.35 + 0.34 * t;
  return [radius * Math.cos(angle), 0.55 * t, radius * Math.sin(angle)];
}

/**
 * 构建策略:
 * 1) 沿螺旋线放置一串互相重叠的球体,布尔并集形成平滑弯曲的实心"壳管";
 * 2) 在路径若干节点放置直径略大于管径的薄圆柱做"隔板",与管体并集,
 *    剖切后能看到一圈圈内部隔壁;
 * 3) 两端各并一个端球封口。
 * 全部是 manifold 原生 CSG,结果必然是有效二维流形。
 */
export async function buildDemoFossilManifold(): Promise<{ m: Manifold; mod: ManifoldModule }> {
  const mod = await getModule();
  const parts: Manifold[] = [];

  const tubeSteps = 80;
  const sphereSegs = 20;
  for (let i = 0; i <= tubeSteps; i++) {
    const t = i / tubeSteps;
    const [x, y, z] = spiralPoint(t);
    const r = 0.22 + 0.12 * t;
    const s = mod.Manifold.sphere(r, sphereSegs).translate([x, y, z]);
    parts.push(s);
  }

  // 内部隔板:沿路径等距放置薄圆柱,方向取路径切线
  const baffleCount = 8;
  for (let k = 1; k <= baffleCount; k++) {
    const t = k / (baffleCount + 1);
    const [x, y, z] = spiralPoint(t);
    const e = 0.002;
    const p0 = spiralPoint(Math.max(0, t - e));
    const p1 = spiralPoint(Math.min(1, t + e));
    const tangent = normalize3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const tubeR = 0.22 + 0.12 * t;
    // 圆柱默认沿 Z 轴,旋转到切线方向
    const q = alignZTo(tangent);
    const cyl = mod.Manifold
      .cylinder(0.04, tubeR * 1.02, tubeR * 1.02, 28, true)
      .transform(mat4FromQuatTranslate(q, [x, y, z]));
    parts.push(cyl);
  }

  // 分层归约并集:平衡 CSG 树深度,比顺序 union 快很多
  let layer = parts;
  while (layer.length > 1) {
    const next: Manifold[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? layer[i].add(layer[i + 1]) : layer[i]);
    }
    layer = next;
  }
  const body = layer[0];
  return { m: body, mod };
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 四元数,把 +Z 旋转到目标方向 */
function alignZTo(target: [number, number, number]): [number, number, number, number] {
  const z: [number, number, number] = [0, 0, 1];
  const d = normalize3(target);
  const dot = z[0] * d[0] + z[1] * d[1] + z[2] * d[2];
  if (dot > 0.999999) return [0, 0, 0, 1];
  if (dot < -0.999999) return [1, 0, 0, 0];
  const ax = z[1] * d[2] - z[2] * d[1];
  const ay = z[2] * d[0] - z[0] * d[2];
  const az = z[0] * d[1] - z[1] * d[0];
  const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
  const s = Math.sin(ang / 2);
  return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
}

/** 四元数+平移 → 列主序 4x4 */
function mat4FromQuatTranslate(q: [number, number, number, number], t: [number, number, number]): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // 列主序
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    t[0], t[1], t[2], 1
  ];
}

/** 对外保持与旧接口同名:返回可直接送入 worker 的三角网格 */
export async function buildDemoFossil(): Promise<DemoMesh> {
  const { m } = await buildDemoFossilManifold();
  const mesh = m.getMesh();
  const vertexCount = m.numVert();
  const vertices = mesh.vertProperties.slice(0, mesh.numProp * vertexCount);
  const indices = mesh.triVerts.slice();
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    name: 'demo-ammonite.stl'
  };
}
