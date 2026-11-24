import type { MaterialDef } from '../types'

export const MATERIALS: MaterialDef[] = [
  { id: 'mat-pearl', name: '珍珠白哑光', category: '素色烤漆', color: '#f7f3ea', color2: '#ffffff', metalness: 0, roughness: 0.82, finish: 'matte' },
  { id: 'mat-cloud-gray', name: '云岩浅灰', category: '素色烤漆', color: '#cfd5dd', color2: '#eef1f5', metalness: 0.02, roughness: 0.78, finish: 'matte' },
  { id: 'mat-graphite', name: '石墨深空黑', category: '素色烤漆', color: '#151821', color2: '#3b4250', metalness: 0.08, roughness: 0.55, finish: 'matte' },
  { id: 'mat-brand-blue', name: '发布会蓝', category: '品牌主色', color: '#1355ff', color2: '#5f8cff', metalness: 0.05, roughness: 0.42, finish: 'matte' },
  { id: 'mat-cyan', name: '能量青', category: '品牌主色', color: '#00a7c8', color2: '#55e6f5', metalness: 0.08, roughness: 0.36, finish: 'light', emissive: '#00a7c8', emissiveIntensity: 0.12 },
  { id: 'mat-red', name: '开幕红', category: '品牌主色', color: '#dc1f44', color2: '#ff6b85', metalness: 0.04, roughness: 0.42, finish: 'matte' },
  { id: 'mat-violet', name: '星云紫', category: '品牌主色', color: '#6d28d9', color2: '#b794ff', metalness: 0.08, roughness: 0.38, finish: 'light', emissive: '#6d28d9', emissiveIntensity: 0.1 },
  { id: 'mat-green', name: '生态绿', category: '品牌主色', color: '#147a52', color2: '#55d39b', metalness: 0.03, roughness: 0.58, finish: 'matte' },
  { id: 'mat-orange', name: '落日橙', category: '品牌主色', color: '#f26a1b', color2: '#ffc078', metalness: 0.03, roughness: 0.5, finish: 'matte' },
  { id: 'mat-silver', name: '拉丝银金属', category: '金属', color: '#aab3c2', color2: '#f4f7fb', metalness: 0.82, roughness: 0.24, finish: 'metal' },
  { id: 'mat-champagne', name: '香槟金', category: '金属', color: '#b9903f', color2: '#f5df9b', metalness: 0.72, roughness: 0.27, finish: 'metal' },
  { id: 'mat-chrome', name: '镜面铬', category: '金属', color: '#d8dee8', color2: '#ffffff', metalness: 1, roughness: 0.08, finish: 'metal' },
  { id: 'mat-oak', name: '浅橡木纹饰', category: '木纹', color: '#b87f43', color2: '#e7c18a', metalness: 0, roughness: 0.62, finish: 'wood' },
  { id: 'mat-walnut', name: '胡桃木纹饰', category: '木纹', color: '#60381c', color2: '#a87545', metalness: 0, roughness: 0.58, finish: 'wood' },
  { id: 'mat-concrete', name: '清水混凝土', category: '肌理', color: '#9fa3a4', color2: '#d2d4d2', metalness: 0, roughness: 0.95, finish: 'matte' },
  { id: 'mat-glass-blue', name: '浅蓝亚克力', category: '透光材质', color: '#8ed8ff', color2: '#e5f8ff', metalness: 0, roughness: 0.12, opacity: 0.58, finish: 'glass' },
  { id: 'mat-lightbox', name: '柔光灯箱白', category: '发光材质', color: '#fff7d6', color2: '#ffffff', metalness: 0, roughness: 0.25, finish: 'light', emissive: '#fff1b8', emissiveIntensity: 0.72 },
  { id: 'mat-led-dark', name: 'LED 黑曜屏', category: '发光材质', color: '#07111f', color2: '#163b67', metalness: 0.15, roughness: 0.18, finish: 'light', emissive: '#0a84ff', emissiveIntensity: 0.22 },
]

export const materialMap = new Map(MATERIALS.map((m) => [m.id, m]))

export function getMaterial(id: string | undefined): MaterialDef {
  return materialMap.get(id ?? '') ?? MATERIALS[0]
}
