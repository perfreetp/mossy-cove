export const CLOUD_VERTEX_SHADER = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = world * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

export const CLOUD_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float time;
uniform float coverage;
uniform float density;
uniform float bandSeed;
uniform float sheetSeed;
uniform float sheetAlpha;
uniform vec3 cameraPosition;
uniform vec3 fogColor;
uniform sampler2D maskTex;

varying vec2 vUv;
varying vec3 vWorldPosition;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p = p * 2.04 + vec2(7.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  vec2 drift = vec2(time * 0.005, time * 0.0018);
  float large = fbm(uv * 6.4 + vec2(bandSeed, sheetSeed) + drift);
  float fine = fbm(uv * 17.0 - drift * 1.4 + vec2(sheetSeed * 1.7, bandSeed));
  float noiseValue = large * 0.76 + fine * 0.24;

  float threshold = mix(0.82, 0.27, coverage);
  float cloudShape = smoothstep(threshold, threshold + 0.24, noiseValue);
  float userMask = texture2D(maskTex, uv).r;

  // Fade the square geometry boundary; terrain intersection remains depth-tested.
  vec2 edgeUv = abs(uv - 0.5) * 2.0;
  float edgeFade = 1.0 - smoothstep(0.72, 1.0, max(edgeUv.x, edgeUv.y));

  float alpha = cloudShape * density * userMask * edgeFade * sheetAlpha;
  if (alpha < 0.012) discard;

  float light = 0.74 + 0.26 * smoothstep(0.25, 0.86, noiseValue);
  vec3 cloudShadow = vec3(0.56, 0.65, 0.78);
  vec3 cloudLight = vec3(1.0, 0.99, 0.965);
  vec3 color = mix(cloudShadow, cloudLight, light);

  float viewDistance = length(cameraPosition - vWorldPosition);
  float fogAmount = smoothstep(280.0, 680.0, viewDistance);
  color = mix(color, fogColor, fogAmount * 0.72);
  alpha *= 1.0 - fogAmount * 0.68;

  gl_FragColor = vec4(color, alpha);
}
`

export const SKY_VERTEX_SHADER = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

export const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec3 vDirection;

void main() {
  float h = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.82, 0.91, 1.0);
  vec3 middle = vec3(0.50, 0.73, 0.94);
  vec3 zenith = vec3(0.16, 0.43, 0.82);
  vec3 color = mix(horizon, middle, smoothstep(0.47, 0.62, h));
  color = mix(color, zenith, smoothstep(0.60, 1.0, h));

  vec3 sunDirection = normalize(vec3(-0.42, 0.48, -0.77));
  float sun = max(dot(normalize(vDirection), sunDirection), 0.0);
  color += vec3(1.0, 0.78, 0.48) * pow(sun, 420.0) * 1.8;
  color += vec3(1.0, 0.72, 0.42) * pow(sun, 10.0) * 0.16;

  float below = 1.0 - smoothstep(0.42, 0.52, h);
  color = mix(color, vec3(0.76, 0.84, 0.93), below * 0.45);
  gl_FragColor = vec4(color, 1.0);
}
`
