import * as THREE from 'three';

export interface TerrainUniforms {
  uHeightMin: { value: number };
  uHeightMax: { value: number };
  uShowContours: { value: number };
  uContourLevels: { value: number[] };
}

export function createTerrainMaterial(uniforms: TerrainUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSandWorldPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSandWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSandWorldPos;
        uniform float uHeightMin;
        uniform float uHeightMax;
        uniform float uShowContours;
        uniform float uContourLevels[6];

        vec3 sandHeightPalette(float t) {
          float q = min(6.0, floor(clamp(t, 0.0, 0.9999) * 7.0));
          if (q < 0.5) return vec3(0.16, 0.34, 0.27);
          if (q < 1.5) return vec3(0.25, 0.48, 0.31);
          if (q < 2.5) return vec3(0.43, 0.58, 0.30);
          if (q < 3.5) return vec3(0.67, 0.66, 0.36);
          if (q < 4.5) return vec3(0.78, 0.61, 0.35);
          if (q < 5.5) return vec3(0.62, 0.43, 0.30);
          return vec3(0.91, 0.89, 0.80);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sandT = clamp((vSandWorldPos.y - uHeightMin) / max(0.001, uHeightMax - uHeightMin), 0.0, 1.0);
        vec3 sandColor = sandHeightPalette(sandT);

        if (uShowContours > 0.5) {
          float contourMask = 0.0;
          for (int contourIndex = 0; contourIndex < 6; contourIndex++) {
            float pixelHeight = max(fwidth(vSandWorldPos.y), 0.0008);
            float distanceInPixels = abs(vSandWorldPos.y - uContourLevels[contourIndex]) / pixelHeight;
            contourMask = max(contourMask, 1.0 - smoothstep(0.35, 1.45, distanceInPixels));
          }
          sandColor = mix(sandColor, vec3(0.20, 0.15, 0.10), contourMask * 0.62);
        }
        diffuseColor.rgb = sandColor;
      `);
  };

  material.customProgramCacheKey = () => 'micro-sandbox-terrain-v1';
  return material;
}
