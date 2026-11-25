import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

export type ExportFormat = 'obj' | 'stl' | 'gltf' | 'glb';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 导出裁剪后的网格（断面按 group 保留为独立材质，OBJ/GLTF 可见分层） */
export async function exportMesh(
  mesh: THREE.Mesh,
  format: ExportFormat,
  filename: string,
): Promise<void> {
  const clone = mesh.clone();
  clone.geometry = mesh.geometry.clone();
  // 导出属性清理：内部编辑标记不写入文件
  clone.geometry.deleteAttribute('aCap');

  const base = filename.replace(/\.(obj|stl|gltf|glb)$/i, '');

  if (format === 'obj') {
    const text = new OBJExporter().parse(clone);
    triggerDownload(new Blob([text], { type: 'text/plain' }), `${base}.obj`);
    return;
  }

  if (format === 'stl') {
    const text = new STLExporter().parse(clone);
    triggerDownload(new Blob([text], { type: 'text/plain' }), `${base}.stl`);
    return;
  }

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(clone, {
    binary: format === 'glb',
    onlyVisible: true,
  });
  if (format === 'glb') {
    triggerDownload(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `${base}.glb`);
  } else {
    const text = JSON.stringify(result, null, 2);
    triggerDownload(new Blob([text], { type: 'model/gltf+json' }), `${base}.gltf`);
  }
}
