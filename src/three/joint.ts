import {
  Box3,
  BoxGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import './bvh';

export interface JointPart {
  id: string;
  name: string;
  mesh: Mesh;
}

export interface JointModel {
  parts: JointPart[];
  bounds: Box3;
}

/**
 * 程序生成三构件咬合的透榫节点(单位:米):
 *  - 立柱:1.2 x 5.0 x 1.2,带 X 向贯通榫眼(0.6 x 0.5)
 *  - 梁:  X 向,截面 0.7 x 0.6,端部榫头 0.5 x 0.5 穿过榫眼并出头
 *  - 木楔:Z 向扁楔,楔入榫头出头部分
 */
export function buildJoint(materials: {
  vertical: MeshStandardMaterial;
  horizontal: MeshStandardMaterial;
}): JointModel {
  const parts: JointPart[] = [];

  // ---------- 立柱:YZ 平面带方孔的矩形,沿 X 拉伸 ----------
  const columnShape = new Shape();
  columnShape.moveTo(-0.6, -0.6);
  columnShape.lineTo(0.6, -0.6);
  columnShape.lineTo(0.6, 0.6);
  columnShape.lineTo(-0.6, 0.6);
  columnShape.closePath();

  const mortiseHole = new Shape();
  // shape 的 X -> 世界 Z,shape 的 Y -> 世界 Y;孔 0.5(Z) x 0.6(Y)
  mortiseHole.moveTo(-0.25, -0.3);
  mortiseHole.lineTo(0.25, -0.3);
  mortiseHole.lineTo(0.25, 0.3);
  mortiseHole.lineTo(-0.25, 0.3);
  mortiseHole.closePath();
  columnShape.holes.push(mortiseHole);

  const columnGeo = new ExtrudeGeometry(columnShape, { depth: 1.2, bevelEnabled: false });
  columnGeo.rotateY(-Math.PI / 2); // 拉伸方向 +Z -> -X
  columnGeo.translate(0.6, 0, 0); // 居中到 x ∈ [-0.6, 0.6]
  columnGeo.computeVertexNormals();
  columnGeo.computeBoundsTree();

  const column = new Mesh(columnGeo, materials.vertical);
  column.name = 'column';
  parts.push({ id: 'column', name: '立柱 · 透榫眼', mesh: column });

  // ---------- 梁:梁身 + 榫头 两个 Box 合并 ----------
  const beamBody = new BoxGeometry(3.0, 0.7, 0.6);
  beamBody.translate(2.1, 0, 0); // x ∈ [0.6, 3.6]
  const tenon = new BoxGeometry(1.5, 0.5, 0.5);
  tenon.translate(-0.15, 0, 0); // x ∈ [-0.9, 0.6],穿过立柱并出头 0.3
  const beamGeo = mergeGeometries([beamBody, tenon], false)!;
  beamGeo.computeVertexNormals();
  beamGeo.computeBoundsTree();

  const beam = new Mesh(beamGeo, materials.horizontal);
  beam.name = 'beam';
  parts.push({ id: 'beam', name: '梁 · 榫头', mesh: beam });

  // ---------- 木楔:XY 平面梯形(上宽下窄),沿 Z 拉伸 ----------
  const wedgeShape = new Shape();
  const xC = -0.72; // 位于榫头出头段 x ∈ [-0.9, -0.6]
  wedgeShape.moveTo(xC - 0.07, -0.1);
  wedgeShape.lineTo(xC + 0.07, -0.1);
  wedgeShape.lineTo(xC + 0.11, 0.55);
  wedgeShape.lineTo(xC - 0.11, 0.55);
  wedgeShape.closePath();
  const wedgeGeo = new ExtrudeGeometry(wedgeShape, { depth: 0.12, bevelEnabled: false });
  wedgeGeo.translate(0, 0, -0.06); // z 居中
  wedgeGeo.computeVertexNormals();
  wedgeGeo.computeBoundsTree();

  const wedge = new Mesh(wedgeGeo, materials.vertical);
  wedge.name = 'wedge';
  parts.push({ id: 'wedge', name: '木楔', mesh: wedge });

  const bounds = new Box3();
  for (const p of parts) {
    p.mesh.geometry.boundingBox ??= new Box3();
    p.mesh.geometry.computeBoundingBox();
    bounds.union(p.mesh.geometry.boundingBox!.clone().applyMatrix4(p.mesh.matrixWorld));
  }
  bounds.expandByScalar(0.4); // 剖切面手柄留余量

  return { parts, bounds };
}

/** 各轴在局部 2D 基下的基向量:plane x/y/z -> (uDir, vDir, normal) */
export const PLANE_FRAMES: Record<
  string,
  { normal: Vector3; uDir: Vector3; vDir: Vector3; label: string }
> = {
  x: {
    normal: new Vector3(1, 0, 0),
    uDir: new Vector3(0, 1, 0),
    vDir: new Vector3(0, 0, 1),
    label: 'YZ 面',
  },
  y: {
    normal: new Vector3(0, 1, 0),
    uDir: new Vector3(1, 0, 0),
    vDir: new Vector3(0, 0, 1),
    label: 'XZ 面',
  },
  z: {
    normal: new Vector3(0, 0, 1),
    uDir: new Vector3(1, 0, 0),
    vDir: new Vector3(0, 1, 0),
    label: 'XY 面',
  },
};
