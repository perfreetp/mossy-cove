/** 清晨 / 正午 / 黄昏三套光照预设。角度为光源的方位角(azimuth)与高度角(elevation)。 */

export type LightingPresetId = 'dawn' | 'noon' | 'dusk';

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  /** 方位角（弧度，绕 Y 轴） */
  azimuth: number;
  /** 高度角（弧度，地平线=0，天顶=π/2） */
  elevation: number;
  /** 平行光颜色 */
  sunColor: [number, number, number];
  /** 平行光强度 */
  sunIntensity: number;
  /** 环境光颜色 */
  ambientColor: [number, number, number];
  /** 环境光强度 */
  ambientIntensity: number;
  /** 半球光天空/地面颜色 */
  skyColor: [number, number, number];
  groundColor: [number, number, number];
  /** 天空底色与顶部色（用于程序化天空与雾） */
  fogColor: [number, number, number];
  /** 每预设独立雾浓度，晨昏更淡以保留地形细节 */
  fogDensity: number;
  skyHorizon: [number, number, number];
  skyZenith: [number, number, number];
  /** 云团受光/背光颜色 */
  cloudLit: [number, number, number];
  cloudShadow: [number, number, number];
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  dawn: {
    id: 'dawn',
    label: '清晨',
    azimuth: -2.25,
    elevation: 0.22,
    sunColor: [1.0, 0.9, 0.84],
    sunIntensity: 3.0,
    ambientColor: [0.55, 0.55, 0.58],
    ambientIntensity: 0.42,
    skyColor: [0.62, 0.62, 0.66],
    groundColor: [0.34, 0.33, 0.33],
    /** 雾与环境光保持中性，暖色只出现在天空/云/太阳高光，避免地形固有色被染橙 */
    fogColor: [0.66, 0.66, 0.68],
    fogDensity: 0.0008,
    skyHorizon: [0.92, 0.72, 0.6],
    skyZenith: [0.36, 0.5, 0.74],
    cloudLit: [1.0, 0.78, 0.62],
    cloudShadow: [0.42, 0.44, 0.58]
  },  noon: {
    id: 'noon',
    label: '正午',
    azimuth: 0.6,
    elevation: 1.15,
    sunColor: [1.0, 0.97, 0.9],
    sunIntensity: 4.2,
    ambientColor: [0.72, 0.78, 0.9],
    ambientIntensity: 0.5,
    skyColor: [0.72, 0.82, 0.96],
    groundColor: [0.4, 0.38, 0.34],
    fogColor: [0.7, 0.78, 0.86],
    fogDensity: 0.0009,
    skyHorizon: [0.74, 0.85, 0.96],
    skyZenith: [0.26, 0.46, 0.78],
    cloudLit: [1.0, 0.99, 0.97],
    cloudShadow: [0.56, 0.62, 0.74]
  },
  dusk: {
    id: 'dusk',
    label: '黄昏',
    azimuth: 2.3,
    elevation: 0.16,
    sunColor: [1.0, 0.88, 0.82],
    sunIntensity: 2.2,
    ambientColor: [0.52, 0.51, 0.53],
    ambientIntensity: 0.34,
    skyColor: [0.58, 0.56, 0.58],
    groundColor: [0.3, 0.3, 0.31],
    fogColor: [0.56, 0.55, 0.56],
    fogDensity: 0.0006,
    skyHorizon: [0.86, 0.52, 0.42],
    skyZenith: [0.24, 0.24, 0.44],
    cloudLit: [1.0, 0.6, 0.4],
    cloudShadow: [0.34, 0.3, 0.44]
  }
};

export const LIGHTING_ORDER: LightingPresetId[] = ['dawn', 'noon', 'dusk'];
