// 测试环境替身:模拟 Vite 的 `?url` 导入,返回 manifold.wasm 的真实文件路径
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const wasmPath = resolve(process.cwd(), 'node_modules/manifold-3d/manifold.wasm');
export default pathToFileURL(wasmPath).href;
