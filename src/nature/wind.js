import * as THREE from 'three';

/**
 * SHARED WIND FIELD
 * -----------------
 * One set of uniforms drives grass, branches, blossoms (GPU) and falling
 * petals (CPU). The weather system writes `direction` / `strength`; the
 * uniform objects are shared by reference so every material sees updates
 * without extra work.
 */
export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.6, 0.8).normalize() },
  uWindStrength: { value: 0.4 },
};

export const wind = {
  direction: windUniforms.uWindDir.value,
  get strength() { return windUniforms.uWindStrength.value; },
  set strength(v) { windUniforms.uWindStrength.value = v; },
  get time() { return windUniforms.uTime.value; },

  /** Gust factor in [0.4, 1.2] matching the GLSL `windGust` below. */
  gust(x, z) {
    const t = windUniforms.uTime.value;
    const d = windUniforms.uWindDir.value;
    const wave = Math.sin((x * d.x + z * d.y) * 0.15 - t * 1.7) * 0.5 + 0.5;
    const slow = Math.sin(t * 0.37 + x * 0.02) * 0.5 + 0.5;
    return 0.4 + 0.55 * wave * (0.5 + 0.5 * slow) + 0.25 * slow;
  },

  /** Horizontal wind velocity (m/s) at a point, written into `out` (Vector3). */
  velocityAt(x, y, z, out) {
    const s = this.strength * this.gust(x, z) * (2.2 + y * 0.15);
    const d = windUniforms.uWindDir.value;
    return out.set(d.x * s, 0, d.y * s);
  },
};

/** GLSL implementation, injected into materials by `applyWind`. */
export const WIND_GLSL = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;

float windGust(vec2 p) {
  float wave = sin(dot(p, uWindDir) * 0.15 - uTime * 1.7) * 0.5 + 0.5;
  float slow = sin(uTime * 0.37 + p.x * 0.02) * 0.5 + 0.5;
  return 0.4 + 0.55 * wave * (0.5 + 0.5 * slow) + 0.25 * slow;
}

// World-space displacement for a vertex at world position wp with flexibility "flex".
vec3 windOffset(vec3 wp, float flex) {
  float g = windGust(wp.xz);
  float s = uWindStrength * g;
  float flutter = sin(uTime * (3.1 + uWindStrength * 3.0) + wp.x * 1.3 + wp.z * 1.1 + wp.y * 0.7);
  float flutter2 = sin(uTime * 2.3 + wp.x * 0.7 - wp.z * 1.7);
  vec3 dir = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 side = vec3(-uWindDir.y, 0.0, uWindDir.x);
  return (dir * (s * 0.9 + flutter * 0.18 * s) + side * flutter2 * 0.12 * s) * flex;
}
`;

/**
 * Patch a built-in material so vertices sway in world space.
 * `flexGLSL` is an expression evaluated with `localPos` (object/instance
 * space position) and `wp` (undisplaced world position) in scope.
 * `vertexDecl` is added before main(), `vertexMain` runs after displacement
 * (with `wp4` = displaced world position), `patchFragment(shader)` may edit
 * the fragment shader.
 */
export function applyWind(material, flexGLSL, { vertexDecl = '', vertexMain = '', patchFragment = null, key = '' } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${vertexDecl}`)
      .replace('#include <project_vertex>', /* glsl */`
        vec3 localPos = transformed;
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wp4 = modelMatrix * mvPosition;
        vec3 wp = wp4.xyz;
        float flex = ${flexGLSL};
        wp4.xyz += windOffset(wp, flex);
        ${vertexMain}
        mvPosition = viewMatrix * wp4;
        gl_Position = projectionMatrix * mvPosition;
      `);
    if (patchFragment) patchFragment(shader);
  };
  material.customProgramCacheKey = () => `wind-${key}-${flexGLSL}`;
  return material;
}
