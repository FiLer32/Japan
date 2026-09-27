import * as THREE from 'three';
import { POND, terrainHeight } from '../world/layout.js';

/**
 * FIREFLIES (hotaru)
 * ------------------
 * Additive glowing points that drift and blink over the pond and lawn after
 * dusk. Motion is computed in the vertex shader from per-particle seeds, so
 * the CPU cost is nil. They stay hidden in daylight, rain and thick fog.
 */
export class Fireflies {
  constructor(count = 160) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      const x = POND.cx + Math.cos(a) * (POND.rx + 8) * r;
      const z = POND.cz + Math.sin(a) * (POND.rz + 10) * r;
      pos.set([x, Math.max(terrainHeight(x, z), -0.2) + 0.4 + Math.random() * 1.8, z], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uScale: { value: window.innerHeight * 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime;
        uniform float uScale;
        varying float vBlink;
        void main() {
          vec3 p = position;
          float t = uTime * (0.25 + aSeed * 0.2) + aSeed * 50.0;
          p += vec3(sin(t * 1.3) * 1.2, sin(t * 2.1) * 0.35, cos(t * 0.9) * 1.2);
          vBlink = pow(max(0.0, sin(uTime * (1.1 + aSeed) + aSeed * 30.0)), 6.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.18 * uScale / -mv.z) * (0.5 + vBlink);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uIntensity;
        varying float vBlink;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-d * d * 5.0);
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * (0.15 + vBlink) * uIntensity * 3.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'fireflies';
  }

  update(dt, time, day, weather) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = window.innerHeight * 0.5;
    const k = day.night * (1 - weather.rain) * (1 - weather.fog * 0.7);
    this.uniforms.uIntensity.value = k;
    this.points.visible = k > 0.02;
  }
}
