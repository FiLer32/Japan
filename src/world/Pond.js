import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { WATER_LEVEL, BRIDGES, pondSDF, pondOutline, terrainHeight } from './layout.js';
import { createRockGeometry } from './rocks.js';
import { createRNG } from '../utils/random.js';

/**
 * KOI POND
 * --------
 * Water surface = three.js Reflector (planar mirror render) with a custom
 * shader that adds:
 *  - Refraction: the underwater part of the scene (pond bed, koi, bridge
 *    piers) is rendered into a separate target using a clipping plane and
 *    sampled with normal-based distortion.
 *  - Depth-based absorption: per-vertex water depth tints deeper water.
 *  - Fresnel mix between refraction and reflection.
 *  - Procedural wave normals (wind driven), rain drop rings, and up to
 *    eight expanding ripple rings (koi jumps, splashes).
 *  - Sun/moon specular glints.
 */
const MAX_RIPPLES = 8;

const waterVertex = /* glsl */`
uniform mat4 textureMatrix;
attribute float aDepth;
varying vec4 vUv;
varying vec3 vWorld;
varying float vDepth;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vDepth = aDepth;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const waterFragment = /* glsl */`
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform sampler2D tRefraction;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRain;
uniform float uWind;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uDeepColor;
uniform vec3 uAmbient;
varying vec4 vUv;
varying vec3 vWorld;
varying float vDepth;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Gradient of a sum of directional sine waves.
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  float amp = 0.012 + uWind * 0.03;
  vec2 dirs[5];
  dirs[0] = normalize(vec2(1.0, 0.3)); dirs[1] = normalize(vec2(-0.4, 1.0));
  dirs[2] = normalize(vec2(0.7, -0.8)); dirs[3] = normalize(vec2(-1.0, -0.2));
  dirs[4] = normalize(vec2(0.2, 0.9));
  float freqs[5]; freqs[0] = 1.3; freqs[1] = 2.1; freqs[2] = 3.7; freqs[3] = 5.3; freqs[4] = 8.9;
  for (int i = 0; i < 5; i++) {
    float f = freqs[i];
    float ph = dot(dirs[i], p) * f + t * sqrt(9.8 * f) * 0.35;
    g += dirs[i] * f * amp * cos(ph) / (1.0 + float(i) * 0.6);
  }
  return g;
}

// Expanding rain-drop rings on a jittered grid (two layers).
vec2 rainGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 0.7 : 0.45;
    vec2 q = p / sc + float(layer) * 7.31;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h = hash12(cell);
    if (h > uRain * 0.95) continue;
    vec2 c = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.6 + 0.2;
    float life = fract(t * (0.9 + h * 0.5) + h * 11.0);
    vec2 dv = f - c;
    float d = length(dv) * sc;
    float r = life * 0.28;
    float k = d - r;
    float ring = sin(k * 70.0) * exp(-k * k * 900.0) * (1.0 - life) * (1.0 - life);
    g += normalize(dv + 1e-5) * ring * 0.9;
  }
  return g;
}

// Large rings from koi jumps and other splashes.
vec2 rippleGrad(vec2 p) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 dv = p - r.xy;
    float d = length(dv);
    float front = age * 1.1;
    float k = d - front;
    float env = exp(-k * k * 5.0) * pow(1.0 - age / 5.0, 2.0);
    // Several trailing crests behind the leading front.
    float wave = cos(k * 16.0) * env * step(k, 0.35);
    g += normalize(dv + 1e-5) * wave * r.w * 0.35;
  }
  return g;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWorld.xz;
  vec2 grad = waveGrad(p, uTime) + rainGrad(p, uTime) * uRain + rippleGrad(p);
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  // Reflection (projective lookup, distorted by the surface normal).
  vec4 ruv = vUv;
  ruv.xy += N.xz * 0.35 * ruv.w * 0.25;
  vec3 reflection = texture2DProj(tDiffuse, ruv).rgb;

  // Refraction: screen-space lookup into the underwater render.
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec2 offs = N.xz * 0.035 * clamp(vDepth, 0.2, 1.0);
  vec3 refraction = texture2D(tRefraction, clamp(suv + offs, 0.001, 0.999)).rgb;

  // Absorption: longer optical path through deeper water.
  float path = vDepth / max(NdV, 0.25);
  float absorb = 1.0 - exp(-path * 1.25);
  vec3 tint = vec3(0.62, 0.86, 0.78);
  vec3 body = mix(refraction * tint, uDeepColor * uAmbient, absorb);

  vec3 col = mix(body, reflection, clamp(fresnel * 0.92 + 0.04, 0.0, 1.0));

  // Specular glint from the sun or moon.
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 380.0) * 4.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.08;
  col += uLightColor * spec * step(0.0, uLightDir.y);

  // Soft shoreline: fade the surface into the bank where it is very shallow.
  float shore = smoothstep(0.0, 0.1, vDepth);
  col = mix(refraction, col, shore);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Pond {
  constructor(renderer, materials, quality) {
    this.group = new THREE.Group();
    this.group.name = 'pond';
    this.renderer = renderer;
    this.time = 0;
    this._rippleIndex = 0;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const scale = quality.waterResolution;
    this._scale = scale;
    this.refractionTarget = new THREE.WebGLRenderTarget(Math.max(2, size.x * scale), Math.max(2, size.y * scale), {
      type: THREE.HalfFloatType,
    });
    this.resolution = size.clone();

    // --- Water surface ------------------------------------------------
    const shader = {
      name: 'KoiPondWater',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        tRefraction: { value: null },
        uResolution: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uRain: { value: 0 },
        uWind: { value: 0.3 },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: new THREE.Color() },
        uDeepColor: { value: new THREE.Color(0x0e2a2a) },
        uAmbient: { value: new THREE.Color(1, 1, 1) },
      }]),
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
    };
    this.water = new Reflector(createWaterGeometry(), {
      shader,
      textureWidth: Math.max(2, size.x * scale),
      textureHeight: Math.max(2, size.y * scale),
      clipBias: 0.003,
      multisample: 0,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_LEVEL;
    this.water.material.fog = true;
    this.water.name = 'water';
    this.uniforms = this.water.material.uniforms;
    this.uniforms.tRefraction.value = this.refractionTarget.texture;
    this.uniforms.uResolution.value.copy(size);
    this.group.add(this.water);

    // Hide heavy / irrelevant objects while the mirror view renders.
    this.reflectionHidden = [];
    const reflectorBefore = this.water.onBeforeRender;
    this.water.onBeforeRender = (r, scene, camera) => {
      const vis = this.reflectionHidden.map((o) => o.visible);
      this.reflectionHidden.forEach((o) => { o.visible = false; });
      reflectorBefore(r, scene, camera);
      this.reflectionHidden.forEach((o, i) => { o.visible = vis[i]; });
    };

    this._clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), WATER_LEVEL + 0.02);

    this.group.add(createEdgeRocks(materials));
    const pads = createLilyPads();
    this.pads = pads;
    this.group.add(pads.group);
  }

  /** Register an expanding ripple ring. */
  addRipple(x, z, strength = 1) {
    const r = this.uniforms.uRipples.value[this._rippleIndex];
    r.set(x, z, this.time, strength);
    this._rippleIndex = (this._rippleIndex + 1) % MAX_RIPPLES;
  }

  /**
   * Render the underwater part of the scene into the refraction target.
   * Called once per frame before the main render.
   */
  renderRefraction(scene, camera, hidden) {
    const r = this.renderer;
    const vis = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    this.water.visible = false;
    const oldPlanes = r.clippingPlanes;
    const oldTarget = r.getRenderTarget();
    const oldAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.clippingPlanes = [this._clipPlane];
    r.setRenderTarget(this.refractionTarget);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(oldTarget);
    r.clippingPlanes = oldPlanes;
    r.shadowMap.autoUpdate = oldAuto;
    this.water.visible = true;
    hidden.forEach((o, i) => { o.visible = vis[i]; });
  }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const s = this._scale;
    this.refractionTarget.setSize(Math.max(2, size.x * s), Math.max(2, size.y * s));
    this.water.getRenderTarget().setSize(Math.max(2, size.x * s), Math.max(2, size.y * s));
    this.uniforms.uResolution.value.copy(size);
  }

  update(dt, time, day, weather, light, hemi) {
    this.time = time;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uRain.value = weather.rain;
    u.uWind.value = weather.wind;
    u.uLightDir.value.copy(light.position).sub(light.target.position).normalize();
    u.uLightColor.value.copy(light.color).multiplyScalar(light.intensity * (1 - weather.overcast * 0.7));
    u.uAmbient.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.6 + 0.02);
    this.pads.update(time, weather);
  }
}

/** Grid clipped to the pond outline, with per-vertex water depth. */
function createWaterGeometry() {
  const outline = pondOutline(96, 1.2);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
  }
  const step = 0.5;
  const nx = Math.ceil((maxX - minX) / step), nz = Math.ceil((maxZ - minZ) / step);
  const positions = [], depth = [], index = [];
  const inside = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * step, z = minZ + j * step;
      // Local XY plane: the Reflector's normal is +Z, rotated to +Y later.
      positions.push(x, -z, 0);
      depth.push(Math.max(0, WATER_LEVEL - terrainHeight(x, z)));
      inside.push(pondSDF(x, z) < 1.0);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      if (inside[a] || inside[b] || inside[c] || inside[d]) index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Natural stones lining the bank, partially submerged. */
function createEdgeRocks(materials) {
  const group = new THREE.Group();
  const rng = createRNG(21);
  const variants = [0, 1, 2, 3].map((k) => createRockGeometry(100 + k));
  const buckets = variants.map(() => []);
  const outline = pondOutline(140, 0.15);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  outline.forEach((pt, i) => {
    if (BRIDGES.some((b) => Math.abs(pt.x - b.x) < 2.2)) return;
    if (rng.next() < 0.18) return;
    const size = rng.range(0.3, 0.75) * (i % 9 === 0 ? 1.7 : 1);
    p.set(pt.x + rng.range(-0.2, 0.2), terrainHeight(pt.x, pt.y) + size * 0.1, pt.y + rng.range(-0.2, 0.2));
    q.setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.next() * Math.PI * 2, rng.range(-0.2, 0.2)));
    s.set(size * rng.range(0.9, 1.4), size * rng.range(0.7, 1.1), size);
    m.compose(p, q, s);
    buckets[i % variants.length].push(m.clone());
  });
  variants.forEach((geo, k) => {
    const mesh = new THREE.InstancedMesh(geo, materials.rock, buckets[k].length);
    buckets[k].forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

/** Floating lily pads with a few lotus blooms. */
function createLilyPads() {
  const group = new THREE.Group();
  const rng = createRNG(4);
  const padGeo = new THREE.CircleGeometry(1, 22, 0.2, Math.PI * 2 - 0.4);
  padGeo.rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, side: THREE.DoubleSide });
  const pads = [];
  const clusters = [[13, 3.5], [20, 9], [27, 5], [16.5, 8.5], [6.5, 7], [29.5, 7.5]];
  for (const [cx, cz] of clusters) {
    const n = rng.int(6, 10);
    for (let i = 0; i < n; i++) {
      const x = cx + rng.gauss(0, 1.1), z = cz + rng.gauss(0, 0.8);
      if (pondSDF(x, z) > -0.8) continue;
      if (BRIDGES.some((b) => Math.abs(x - b.x) < 1.8)) continue;
      pads.push({ x, z, r: rng.range(0.22, 0.45), rot: rng.next() * Math.PI * 2, phase: rng.next() * 6 });
    }
  }
  const mesh = new THREE.InstancedMesh(padGeo, padMat, pads.length);
  const col = new THREE.Color();
  pads.forEach((pd, i) => {
    col.setHSL(0.25 + rng.range(-0.03, 0.04), 0.55, rng.range(0.18, 0.3));
    mesh.setColorAt(i, col);
  });
  mesh.receiveShadow = true;
  group.add(mesh);

  // Lotus flowers: lathe cups of petals.
  const lotusPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    lotusPts.push(new THREE.Vector2(0.02 + Math.sin(t * Math.PI * 0.55) * 0.14, t * 0.14));
  }
  const lotusGeo = new THREE.LatheGeometry(lotusPts, 10);
  const lotusMat = new THREE.MeshStandardMaterial({ color: 0xf2b6c8, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x401020, emissiveIntensity: 0.2 });
  const lotuses = pads.filter((_, i) => i % 6 === 0).map((pd) => {
    const l = new THREE.Mesh(lotusGeo, lotusMat);
    l.position.set(pd.x + 0.05, WATER_LEVEL + 0.02, pd.z);
    l.castShadow = true;
    group.add(l);
    return l;
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const update = (time, weather) => {
    const agitation = 0.3 + weather.wind + weather.rain;
    pads.forEach((pd, i) => {
      p.set(pd.x + Math.sin(time * 0.2 + pd.phase) * 0.05, WATER_LEVEL + 0.012 + Math.sin(time * 1.3 + pd.phase) * 0.004 * agitation, pd.z);
      q.setFromEuler(e.set(Math.sin(time * 1.1 + pd.phase) * 0.02 * agitation, pd.rot + Math.sin(time * 0.15 + pd.phase) * 0.2, 0));
      s.setScalar(pd.r);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    lotuses.forEach((l, i) => { l.rotation.y = time * 0.05 + i; });
  };
  update(0, { wind: 0, rain: 0 });
  return { group, update };
}

