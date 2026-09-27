import * as THREE from 'three';
import { wind } from '../nature/wind.js';

/**
 * RAIN + MIST
 * -----------
 * Rain: thousands of line-segment streaks animated entirely on the GPU. Each
 * drop lives in a box that wraps around the camera, so the effect is
 * infinite yet costs one draw call. The draw range scales with intensity.
 *
 * Mist: large, soft, camera-facing sprites drifting low over the ground,
 * fading in with the fog amount.
 */
const rainVertex = /* glsl */`
attribute vec3 aSeed;     // xyz in [0,1)
attribute float aEnd;     // 0 = head, 1 = tail
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVel;        // fall velocity (with wind slant)
uniform float uLength;
varying float vFade;
#include <fog_pars_vertex>

void main() {
  vec3 p = aSeed * uBox;
  p += uVel * uTime * (0.85 + aSeed.x * 0.3);
  // Wrap into the box around the camera.
  p = mod(p - uCenter + uBox * 0.5, uBox) + uCenter - uBox * 0.5;
  p -= normalize(uVel) * uLength * aEnd;
  vFade = 1.0 - aEnd * 0.9;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Fade drops near the box edges to hide the wrap.
  vec3 q = abs(p - uCenter) / (uBox * 0.5);
  vFade *= 1.0 - smoothstep(0.7, 1.0, max(q.x, q.z));
  #include <fog_vertex>
}
`;

const rainFragment = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <fog_fragment>
}
`;

export class Precipitation {
  constructor(scene, materials, quality) {
    this.maxDrops = quality.rainDrops;
    const seeds = new Float32Array(this.maxDrops * 2 * 3);
    const ends = new Float32Array(this.maxDrops * 2);
    for (let i = 0; i < this.maxDrops; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) {
        seeds.set([x, y, z], (i * 2 + k) * 3);
        ends[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxDrops * 6), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    geo.setDrawRange(0, 0);

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(60, 34, 60) },
      uVel: { value: new THREE.Vector3(0, -14, 0) },
      uLength: { value: 0.55 },
      uColor: { value: new THREE.Color(0xaab4c4) },
      uOpacity: { value: 0.35 },
    }]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: rainVertex,
      fragmentShader: rainFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.name = 'rain';
    this.rain.visible = false;
    scene.add(this.rain);

    // --- Mist sprites ----------------------------------------------------
    this.mist = new THREE.Group();
    this.mist.name = 'mist';
    this.mistMaterial = new THREE.SpriteMaterial({
      map: materials.mistTexture, transparent: true, depthWrite: false, opacity: 0, fog: false,
      color: 0xffffff,
    });
    this.sprites = [];
    for (let i = 0; i < quality.mistSprites; i++) {
      const s = new THREE.Sprite(this.mistMaterial);
      const r = 8 + Math.random() * 48;
      const a = Math.random() * Math.PI * 2;
      s.position.set(6 + Math.cos(a) * r, 0.8 + Math.random() * 2.2, Math.sin(a) * r);
      const size = 14 + Math.random() * 16;
      s.scale.set(size, size * 0.45, 1);
      s.userData.speed = 0.5 + Math.random();
      this.sprites.push(s);
      this.mist.add(s);
    }
    this.mist.visible = false;
    scene.add(this.mist);
  }

  update(dt, time, camera, weather, day) {
    const u = this.uniforms;
    const rain = weather.rain;

    // --- Rain ----------------------------------------------------------
    const count = Math.floor(this.maxDrops * Math.min(1, rain * 1.1));
    this.rain.visible = count > 20;
    this.rain.geometry.setDrawRange(0, count * 2);
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
    u.uCenter.value.y = Math.max(camera.position.y, 8);
    const w = wind.direction, ws = wind.strength * 5;
    u.uVel.value.set(w.x * ws, -13, w.y * ws);
    // Rain is lit by the sky: dim at night, with a warm hint near lanterns.
    const bright = 0.15 + day.daylight * 0.85;
    u.uColor.value.setRGB(0.62 * bright + 0.06, 0.68 * bright + 0.06, 0.78 * bright + 0.08);
    u.uOpacity.value = 0.18 + rain * 0.22;

    // --- Mist ------------------------------------------------------------
    const mistAmount = Math.min(1, weather.fog * 1.1 + rain * 0.25);
    this.mist.visible = mistAmount > 0.01;
    if (this.mist.visible) {
      this.mistMaterial.opacity = mistAmount * 0.32;
      this.mistMaterial.color.copy(day.fogColor).multiplyScalar(1.15);
      for (const s of this.sprites) {
        s.position.x += w.x * s.userData.speed * dt * (0.4 + wind.strength);
        s.position.z += w.y * s.userData.speed * dt * (0.4 + wind.strength);
        // Recycle sprites that drift out of the garden.
        if (Math.hypot(s.position.x - 6, s.position.z) > 60) {
          s.position.x = 6 - w.x * 55 + (Math.random() - 0.5) * 40;
          s.position.z = -w.y * 55 + (Math.random() - 0.5) * 40;
        }
      }
    }
  }

  /** Objects to hide while rendering water reflections/refractions. */
  get reflectionHidden() { return [this.rain, this.mist]; }
}
