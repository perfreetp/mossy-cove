import { MercatorCoordinate } from 'maplibre-gl'
import type { CustomLayerInterface, CustomRenderMethod, Map as MLMap } from 'maplibre-gl'
import { mat4Identity, mat4Multiply, mat4Scale, mat4Translate } from '../lib/mat4'
import type { Mat4 } from '../lib/mat4'
import { ORIGIN_LAT, ORIGIN_LNG } from '../constants'
import type { MeshData } from '../lib/geometry'

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aGrain;
uniform mat4 uMVP;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGrain;
varying vec3 vLocal;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = aNormal;
  vColor = aColor;
  vGrain = aGrain;
  vLocal = aPos;
}`

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGrain;
varying vec3 vLocal;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec3 L = normalize(vec3(0.45, -0.55, 0.75));
  float ndl = max(dot(normalize(vNormal), L), 0.0);
  float light = 0.40 + 0.65 * ndl;
  float n = hash21(floor(vLocal.xy * 1.1));
  float grain = (n - 0.5) * vGrain * 0.75;
  vec3 col = vColor * light + grain;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

interface GLMesh {
  pos: WebGLBuffer
  normal: WebGLBuffer
  color: WebGLBuffer
  grain: WebGLBuffer
  index: WebGLBuffer
  count: number
  indexType: number
}

type MeshKey = 'terrain' | 'curb' | 'road' | 'highlight' | 'nodes'

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile: ' + gl.getShaderInfoLog(sh))
  }
  return sh
}

export interface SandboxLayerHandle {
  layer: CustomLayerInterface
  updateMesh(key: MeshKey, data: MeshData | null): void
  getMVP(): Mat4
}

/**
 * 以对象字面量创建自定义图层 —— MapLibre 内部会把对象方法提升到
 * StyleCustomLayer 包装器,class 实例方法在该路径下会丢失。
 */
export function createSandboxLayer(): SandboxLayerHandle {
  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let loc: Record<string, number> = {}
  let model: Mat4 = mat4Identity()
  let lastMVP: Mat4 = mat4Identity()
  let uint32Supported = false
  const order: MeshKey[] = ['terrain', 'curb', 'road', 'highlight', 'nodes']
  const meshes: Record<MeshKey, GLMesh | null> = {
    terrain: null,
    curb: null,
    road: null,
    highlight: null,
    nodes: null
  }
  // onAdd 之前到达的网格数据先缓存,拿到 GL 上下文后补建
  const pendingMeshes: Partial<Record<MeshKey, MeshData | null>> = {}

  const deleteMesh = (key: MeshKey) => {
    if (!gl) return
    const m = meshes[key]
    if (!m) return
    gl.deleteBuffer(m.pos)
    gl.deleteBuffer(m.normal)
    gl.deleteBuffer(m.color)
    gl.deleteBuffer(m.grain)
    gl.deleteBuffer(m.index)
    meshes[key] = null
  }

  const updateMesh = (key: MeshKey, data: MeshData | null) => {
    if (!gl) {
      // onAdd 之前到达的数据先缓存,拿到 GL 上下文后补建
      pendingMeshes[key] = data
      return
    }
    deleteMesh(key)
    if (!data || data.indices.length === 0) return
    const make = (arr: ArrayLike<number>) => {
      const buf = gl!.createBuffer()!
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf)
      gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(arr as number[]), gl!.DYNAMIC_DRAW)
      return buf
    }
    const maxIndex = data.indices.reduce((m, v) => (v > m ? v : m), 0)
    const use32 = uint32Supported && maxIndex > 65535
    const index = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      use32 ? new Uint32Array(data.indices) : new Uint16Array(data.indices),
      gl.DYNAMIC_DRAW
    )
    meshes[key] = {
      pos: make(data.positions),
      normal: make(data.normals),
      color: make(data.colors),
      grain: make(data.grain),
      index,
      count: data.indices.length,
      indexType: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    }
  }

  const render: CustomRenderMethod = (_glArg, matrix) => {
    if (!gl || !program) return
    const mvp = mat4Multiply(Float32Array.from(matrix as unknown as number[]) as Mat4, model)
    lastMVP = mvp

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.useProgram(program)
    gl.uniformMatrix4fv(loc.uMVP, false, mvp)

    for (const key of order) {
      const m = meshes[key]
      if (!m) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos)
      gl.enableVertexAttribArray(loc.aPos)
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, m.normal)
      gl.enableVertexAttribArray(loc.aNormal)
      gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, m.color)
      gl.enableVertexAttribArray(loc.aColor)
      gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, m.grain)
      gl.enableVertexAttribArray(loc.aGrain)
      gl.vertexAttribPointer(loc.aGrain, 1, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.index)
      gl.drawElements(gl.TRIANGLES, m.count, m.indexType, 0)
    }
  }

  const layer: CustomLayerInterface = {
    id: 'sandbox-3d',
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map: MLMap, glCtx: WebGLRenderingContext) {
      gl = glCtx
      uint32Supported = !!gl.getExtension('OES_element_index_uint')
      try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      const prog = gl.createProgram()!
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('program link: ' + gl.getProgramInfoLog(prog))
      }
      program = prog
      loc = {
        aPos: gl.getAttribLocation(prog, 'aPos'),
        aNormal: gl.getAttribLocation(prog, 'aNormal'),
        aColor: gl.getAttribLocation(prog, 'aColor'),
        aGrain: gl.getAttribLocation(prog, 'aGrain'),
        uMVP: gl.getUniformLocation(prog, 'uMVP') as unknown as number
      }

      const mc = MercatorCoordinate.fromLngLat({ lng: ORIGIN_LNG, lat: ORIGIN_LAT }, 0)
      const scale = mc.meterInMercatorCoordinateUnits()
      let m = mat4Translate(mat4Identity(), mc.x, mc.y, mc.z)
      m = mat4Scale(m, scale, -scale, scale)
      model = m

      // 补建 onAdd 前缓存的网格
      const queued = Object.entries(pendingMeshes) as Array<[MeshKey, MeshData | null]>
      for (const [k, d] of queued) {
        updateMesh(k, d)
        delete pendingMeshes[k]
      }
      } catch (err) {
        console.error('[sandbox-layer] onAdd failed', err)
        throw err
      }
    },

    onRemove(_map: MLMap, glCtx: WebGLRenderingContext) {
      for (const key of order) deleteMesh(key)
      if (program) glCtx.deleteProgram(program)
      program = null
      gl = null
    },

    render
  }

  return {
    layer,
    updateMesh,
    getMVP: () => lastMVP
  }
}
