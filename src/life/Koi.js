import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LEVEL, POND, pondSDF, terrainHeight } from '../world/layout.js';
import { createRNG } from '../utils/random.js';

/**
 * KOI
 * ---
 * Fish swim in three loose schools using a lightweight boids model
 * (separation / alignment / cohesion + a wandering school target + pond
 * boundary avoidance). Bodies undulate in the vertex shader, with tail
 * frequency tied to swimming speed. Every so often a koi leaps clear of the
 * water, spawning splash particles and ripple rings on the pond surface.
 */
const SCHOOLS = 3;
const FISH_PER_SCHOOL = 7;
const BODY_LEN = 1.0;

export class KoiPond {
  constructor(materials, pond, quality) {
    this.group = new THREE.Group();
    this.group.name = 'koi';
    this.pond = pond;
    this.rng = createRNG(3);
    this.time = { value: 0 };
    this.fish = [];
    this.schools = [];

    const bodyGeo = createBodyGeometry();
    const finGeo = createFinGeometry();
    const count = Math.round(SCHOOLS * FISH_PER_SCHOOL * quality.koiScale);

    for (let s = 0; s < SCHOOLS; s++) {
      this.schools.push({ target: this._randomPoint(), timer: 0 });
    }
    for (let i = 0; i < count; i++) {
      const school = i % SCHOOLS;
      const variant = this.rng.int(0, materials.koiTextures.length - 1);
      const uniforms = {
        uPhase: { value: this.rng.next() * 10 },
        uSwim: { value: 0 },          // integrated tail phase
        uAmp: { value: 0.08 },
        uCurl: { value: 0 },          // extra bend during jumps / turns
      };
      const bodyMat = makeKoiMaterial(new THREE.MeshStandardMaterial({
        map: materials.koiTextures[variant], roughness: 0.35, metalness: variant === 3 ? 0.55 : 0.05,
      }), uniforms);
      const finMat = makeKoiMaterial(new THREE.MeshStandardMaterial({
        color: variant === 3 ? 0xf2c070 : variant === 5 ? 0x9fb3c6 : 0xf6efe6,
        roughness: 0.4, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false,
      }), uniforms);

      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const fins = new THREE.Mesh(finGeo, finMat);
      body.frustumCulled = fins.frustumCulled = false;
      g.add(body, fins);
      const scale = this.rng.range(0.42, 0.72);
      g.scale.setScalar(scale);
      const p = this._randomPoint();
      g.position.set(p.x, WATER_LEVEL - 0.6, p.z);
      this.group.add(g);
      const ang = this.rng.next() * Math.PI * 2;
      this.fish.push({
        mesh: g, uniforms, school, scale,
        vel: new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(0.4),
        depthPhase: this.rng.next() * 10,
        maxSpeed: this.rng.range(0.55, 0.85),
        jump: null,
        yaw: ang,
      });
    }

    this._jumpTimer = 5;
    this.splash = new SplashParticles(quality.splashParticles);
    this.group.add(this.splash.points);

    // Scratch vectors.
    this._v = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this._align = new THREE.Vector3();
    this._sep = new THREE.Vector3();
  }

  _randomPoint() {
    for (let i = 0; i < 50; i++) {
      const x = POND.cx + (this.rng.next() * 2 - 1) * POND.rx;
      const z = POND.cz + (this.rng.next() * 2 - 1) * POND.rz;
      if (pondSDF(x, z) < -1.6) return { x, z };
    }
    return { x: POND.cx, z: POND.cz };
  }

  update(dt, time, day, weather) {
    dt = Math.min(dt, 0.05);
    this.time.value = time;

    // Wandering school targets.
    for (const s of this.schools) {
      s.timer -= dt;
      if (s.timer <= 0) { s.target = this._randomPoint(); s.timer = 6 + this.rng.next() * 8; }
    }

    // Occasional jump (koi are livelier at dusk and in the rain).
    this._jumpTimer -= dt * (1 + weather.rain * 0.8 + (1 - Math.abs(day.sunElevation * 4)) * 0.5);
    if (this._jumpTimer <= 0) {
      this._jumpTimer = 7 + this.rng.next() * 10;
      const candidates = this.fish.filter((f) => !f.jump && pondSDF(f.mesh.position.x, f.mesh.position.z) < -2.2);
      if (candidates.length) this._startJump(candidates[Math.floor(this.rng.next() * candidates.length)]);
    }

    for (const f of this.fish) {
      if (f.jump) this._updateJump(f, dt);
      else this._swim(f, dt, time);
      // Tail beat: phase advances with speed, amplitude grows with effort.
      const speed = f.jump ? 1.6 : f.vel.length();
      f.uniforms.uSwim.value += dt * (2.5 + speed * 7.0);
      f.uniforms.uAmp.value = 0.05 + Math.min(0.1, speed * 0.1);
    }
    this.splash.update(dt, day);
  }

  _swim(f, dt, time) {
    const p = f.mesh.position;
    const steer = this._steer.set(0, 0, 0);
    const center = this._center.set(0, 0, 0);
    const align = this._align.set(0, 0, 0);
    const sep = this._sep.set(0, 0, 0);
    let mates = 0;
    for (const o of this.fish) {
      if (o === f || o.jump) continue;
      const dx = p.x - o.mesh.position.x, dz = p.z - o.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.8) sep.add(this._v.set(dx, 0, dz).divideScalar(d2 + 0.05));
      if (o.school === f.school && d2 < 16) { center.add(o.mesh.position); align.add(o.vel); mates++; }
    }
    const school = this.schools[f.school];
    steer.add(this._v.set(school.target.x - p.x, 0, school.target.z - p.z).normalize().multiplyScalar(0.35));
    if (mates) {
      center.divideScalar(mates).sub(p);
      center.y = 0;
      steer.add(center.multiplyScalar(0.25));
      steer.add(align.divideScalar(mates).sub(f.vel).multiplyScalar(0.5));
    }
    steer.add(sep.multiplyScalar(0.35));
    // Gentle wander.
    steer.x += Math.sin(time * 0.7 + f.depthPhase * 3) * 0.15;
    steer.z += Math.cos(time * 0.6 + f.depthPhase * 2) * 0.15;

    // Stay inside the pond: look ahead and turn toward the centre.
    const ahead = pondSDF(p.x + f.vel.x * 1.5, p.z + f.vel.z * 1.5);
    if (ahead > -1.3) {
      const k = Math.min(3, (ahead + 1.3) * 2.5);
      steer.add(this._v.set(POND.cx - p.x, 0, POND.cz - p.z).normalize().multiplyScalar(k));
    }

    f.vel.addScaledVector(steer, dt);
    f.vel.y = 0;
    const sp = f.vel.length();
    const maxS = f.maxSpeed;
    if (sp > maxS) f.vel.multiplyScalar(maxS / sp);
    if (sp < 0.2) f.vel.multiplyScalar(0.2 / Math.max(sp, 1e-4));
    p.addScaledVector(f.vel, dt);

    // Hard safety: never leave the water.
    if (pondSDF(p.x, p.z) > -0.6) {
      this._v.set(POND.cx - p.x, 0, POND.cz - p.z).normalize();
      p.addScaledVector(this._v, 0.02);
    }

    // Depth: drift between mid-water and near the surface, above the bed.
    const bed = terrainHeight(p.x, p.z) + 0.22;
    const targetY = Math.max(bed, WATER_LEVEL - 0.35 - 0.3 * (0.5 + 0.5 * Math.sin(time * 0.25 + f.depthPhase)));
    p.y += (targetY - p.y) * Math.min(1, dt * 1.5);

    // Orientation: yaw toward velocity; bank into turns.
    const yaw = Math.atan2(f.vel.x, f.vel.z);
    let dyaw = yaw - f.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    f.yaw += dyaw * Math.min(1, dt * 4);
    f.uniforms.uCurl.value = THREE.MathUtils.clamp(-dyaw * 0.8, -0.35, 0.35);
    f.mesh.rotation.set(0, f.yaw, -dyaw * 0.3, 'YXZ');
  }

  /**
   * Submerged koi are only seen through the refraction texture, so the main
   * and mirror passes skip them (except while a fish is airborne).
   */
  setUnderwaterVisible(all) {
    for (const f of this.fish) f.mesh.visible = all || f.jump !== null;
  }

  _startJump(f) {
    const dir = f.vel.clone().setY(0).normalize();
    f.jump = {
      vel: new THREE.Vector3(dir.x * 1.7, 4.4 + this.rng.next() * 0.8, dir.z * 1.7),
      above: false,
      spin: this.rng.range(-1.5, 1.5),
    };
  }

  _updateJump(f, dt) {
    const j = f.jump;
    const p = f.mesh.position;
    j.vel.y -= 9.8 * dt;
    p.addScaledVector(j.vel, dt);
    const wasAbove = j.above;
    j.above = p.y > WATER_LEVEL;
    if (j.above !== wasAbove) {
      // Crossing the surface: splash + ripple ring.
      this.pond.addRipple(p.x, p.z, j.above ? 0.7 : 1.1);
      this.splash.emit(p.x, WATER_LEVEL, p.z, j.above ? 18 : 30, j.above ? 1.4 : 1.9);
    }
    const horiz = Math.hypot(j.vel.x, j.vel.z);
    const pitch = Math.atan2(j.vel.y, horiz);
    f.mesh.rotation.set(-pitch, f.yaw, Math.sin(j.vel.y) * 0.2 + j.spin * 0.1, 'YXZ');
    f.uniforms.uCurl.value = Math.sin(j.vel.y * 0.8) * 0.3;
    // Resume swimming once back at depth.
    if (!j.above && j.vel.y < 0 && p.y < WATER_LEVEL - 0.55) {
      f.jump = null;
      f.vel.set(j.vel.x, 0, j.vel.z).setLength(0.5);
      f.mesh.rotation.x = 0;
    }
  }
}

/** Inject the swimming undulation into a standard material. */
function makeKoiMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uPhase; uniform float uSwim; uniform float uAmp; uniform float uCurl;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // 0 at the nose (+z), 1 at the tail tip (-z).
        float tailness = clamp((${(BODY_LEN * 0.5).toFixed(2)} - position.z) / ${(BODY_LEN * 1.25).toFixed(2)}, 0.0, 1.0);
        float wave = sin(uSwim + uPhase - tailness * 4.0);
        transformed.x += wave * uAmp * tailness * tailness * 1.4 + uCurl * tailness * tailness;
      `);
  };
  material.customProgramCacheKey = () => `koi-${material.transparent}`;
  return material;
}

/** Lathe body, nose at +z. UVs: u = head→tail, v = around (0.5 = back). */
function createBodyGeometry() {
  const pts = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;                                  // 0 tail → 1 nose
    const r = 0.13 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.8) * (t < 0.12 ? 0.6 + t * 3.3 : 1) + 0.008;
    pts.push(new THREE.Vector2(t === 1 ? 0.001 : r, t * BODY_LEN));
  }
  const g = new THREE.LatheGeometry(pts, 16);
  // Swap UVs to u along the body (head = 0) and v around it.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
  g.rotateX(Math.PI / 2);                            // lathe +Y → +Z (nose forward)
  g.translate(0, 0, -BODY_LEN * 0.5);
  g.scale(0.72, 1, 1);                               // laterally flattened
  g.computeVertexNormals();
  return g;
}

/** Tail, dorsal and pectoral fins merged into one geometry. */
function createFinGeometry() {
  const tail = new THREE.Shape();
  tail.moveTo(0, 0);
  tail.bezierCurveTo(0.08, -0.1, 0.18, -0.2, 0.3, -0.26);
  tail.bezierCurveTo(0.24, -0.08, 0.22, 0.05, 0.3, 0.26);
  tail.bezierCurveTo(0.18, 0.2, 0.08, 0.1, 0, 0);
  const tailGeo = new THREE.ShapeGeometry(tail, 6);
  // Shape lies in XY with length along +X; stand it vertical along -Z.
  tailGeo.rotateY(Math.PI / 2);
  tailGeo.translate(0, 0, -BODY_LEN * 0.5 + 0.02);

  const dorsal = new THREE.Shape();
  dorsal.moveTo(0, 0);
  dorsal.quadraticCurveTo(0.05, 0.1, 0.3, 0.06);
  dorsal.lineTo(0.34, 0);
  const dorsalGeo = new THREE.ShapeGeometry(dorsal, 4);
  dorsalGeo.rotateY(Math.PI / 2);
  dorsalGeo.translate(0, 0.1, 0.12);

  const pect = new THREE.Shape();
  pect.moveTo(0, 0);
  pect.quadraticCurveTo(0.14, 0.02, 0.16, -0.06);
  pect.quadraticCurveTo(0.08, -0.08, 0, 0);
  const pectL = new THREE.ShapeGeometry(pect, 4);
  pectL.rotateX(-Math.PI / 2);
  pectL.rotateZ(-0.35);
  pectL.translate(0.06, -0.05, 0.22);
  const pectR = pectL.clone();
  pectR.scale(-1, 1, 1);

  const merged = mergeGeometries([tailGeo, dorsalGeo, pectL, pectR].map((g) => g.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}

/** Pooled droplets for koi splashes. */
class SplashParticles {
  constructor(max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uColor: { value: new THREE.Color(0xdfeaf0) }, uScale: { value: window.innerHeight * 0.5 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 0.05 * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, vAlpha * (1.0 - d * 1.6));
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x, y, z, n, power) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const h = Math.random() * 0.9 * power;
      this.pos.set([x + Math.cos(a) * 0.1, y + 0.02, z + Math.sin(a) * 0.1], i * 3);
      this.vel.set([Math.cos(a) * h, 1.2 + Math.random() * 2.2 * power, Math.sin(a) * h], i * 3);
      this.life[i] = 1;
    }
  }

  update(dt, day) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.life[i] -= dt * 1.2;
      if (this.pos[i * 3 + 1] < WATER_LEVEL) this.life[i] = 0;
      this.alpha[i] = Math.max(0, this.life[i]) * 0.9;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    const b = 0.12 + day.daylight * 0.88;
    this.uniforms.uColor.value.setRGB(0.85 * b + 0.05, 0.9 * b + 0.05, 0.95 * b + 0.06);
    this.uniforms.uScale.value = window.innerHeight * 0.5;
  }
}
