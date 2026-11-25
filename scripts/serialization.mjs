/** 导出 -> 导入 的场景往返一致性测试（纯逻辑层，不依赖浏览器下载）。 */
import assert from 'node:assert/strict';

const { TerrainModel, DEFAULT_TERRAIN_PARAMS } = await import('../src/lib/noise.ts');
const { buildSerializedScene, parseSceneFile } = await import('../src/lib/storage.ts');
const { distributeCloudsAlongRidges, refreshCloudDerived } = await import('../src/lib/clouds.ts');

const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
terrain.applyBrush(10, -20, 18, 7, 1);
terrain.applyBrush(-30, 40, 12, 5, -1);

const blobs = distributeCloudsAlongRidges(terrain, 12, 99);
refreshCloudDerived(blobs, 0.4);

const scene = buildSerializedScene(
  { ...DEFAULT_TERRAIN_PARAMS },
  terrain.brushMap,
  { blobs, cling: 0.4 },
  'dawn',
  { radius: 20, strength: 8, mode: 'lower' }
);

const text = JSON.stringify(scene);
const restored = parseSceneFile(text);

assert.equal(restored.format, 'cloud-ridge-studio');
assert.equal(restored.clouds.length, 12);
assert.equal(restored.lighting, 'dawn');
assert.equal(restored.cling, 0.4);
assert.equal(restored.brushMap.length, terrain.brushMap.length);
assert.ok(restored.brushMap.some((v) => v !== 0), '笔刷位移应被序列化');
for (let i = 0; i < restored.brushMap.length; i++) {
  assert.ok(Math.abs(restored.brushMap[i] - terrain.brushMap[i]) < 1e-9);
}
assert.deepEqual(restored.brush, { radius: 20, strength: 8, mode: 'lower' });

// 损坏文件应抛出可读错误
assert.throws(() => parseSceneFile('{"format":"wrong"}'), /格式不匹配/);
assert.throws(() => parseSceneFile('not-json'), { name: 'SyntaxError' });

console.log('✓ 场景导出/导入往返与异常处理测试通过');
