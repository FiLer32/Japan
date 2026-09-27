import * as THREE from 'three';
import { wind } from './wind.js';
import { WATER_LEVEL, pondSDF, surfaceHeight } from '../world/layout.js';

/**
 * FALLING PETALS
 * --------------
 * Thousands of individual petals simulated on the CPU and drawn with a
 * single InstancedMesh. Each petal:
 *  - detaches from a random blossom cluster,
 *  - is carried by the shared wind field (with gusts) while tumbling and
 *    fluttering side to side as it falls,
 *  - lands on the ground / bridge decks and rests for a while, or
 *  - floats on the pond, drifting with the breeze before sinking,
 * then respawns. Rain knocks petals down faster and more often.
 */
const FALLING = 0, GROUND = 1, WATER = 2;

export class Petals {
  constructor(emitters, quality) {
    this.emitters = emitters;
    this.count = quality.petals;
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.state = new Uint8Array(n);
    this.timer = new Float32Array(n);
    this.size = new Float32Array(n);
    this.flutter = new Float32Array(n);

    this.mesh = new THREE.InstancedMesh(petalGeometry(), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide,
    }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'petals';
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHSL(0.94 + Math.random() * 0.03, 0.5 + Math.random() * 0.3, 0.84 + Math.random() * 0.1);
      this.mesh.setColorAt(i, c);
      this._spawn(i, true);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  /** Detach petal i from a random blossom cluster (optionally mid-fall). */
  _spawn(i, scatter = false) {
    const e = this.emitters[Math.floor(Math.random() * this.emitters.length)];
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e.r;
    let y = e.y + (Math.random() - 0.5) * e.r;
    if (scatter) y -= Math.random() * e.y;
    this.pos.set([e.x + Math.cos(a) * r, y, e.z + Math.sin(a) * r], i * 3);
    this.vel.set([0, -0.3, 0], i * 3);
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.spin.set([(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6], i * 3);
    this.state[i] = FALLING;
    this.size[i] = 0.8 + Math.random() * 0.5;
    this.flutter[i] = Math.random() * 10;
    // Stagger detachment so petals don't fall in waves.
    this.timer[i] = scatter && Math.random() < 0.6 ? 0 : -Math.random() * (scatter ? 12 : 6);
  }

  update(dt, time, weather) {
    dt = Math.min(dt, 0.05);
    const rainBoost = 1 + weather.rain * 1.8;
    const w = this._w;
    const { pos, vel, rot, spin, state, timer } = this;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      timer[i] += dt;
      if (state[i] === FALLING) {
        if (timer[i] < 0) {           // still attached: hidden until release
          this._write(i, 0);
          timer[i] += dt * (rainBoost - 1);
          continue;
        }
        const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
        wind.velocityAt(x, y, z, w);
        // Drag towards the wind velocity; terminal fall speed with flutter.
        const drag = 1.6;
        const fl = this.flutter[i];
        const sway = Math.sin(time * 2.2 + fl) * 0.6;
        vel[i3] += (w.x + sway * 0.6 - vel[i3]) * drag * dt;
        vel[i3 + 2] += (w.z + Math.cos(time * 1.7 + fl) * 0.4 - vel[i3 + 2]) * drag * dt;
        const fall = -(0.55 + 0.25 * Math.sin(time * 3 + fl)) * (1 + weather.rain * 1.6);
        vel[i3 + 1] += (fall - vel[i3 + 1]) * 2.5 * dt;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        rot[i3] += spin[i3] * dt * (1 + weather.wind);
        rot[i3 + 1] += spin[i3 + 1] * dt;
        rot[i3 + 2] += spin[i3 + 2] * dt * (1 + weather.wind);

        // Landing (only tested near the ground: terrain + bridges stay below ~2.5 m).
        const px = pos[i3], pz = pos[i3 + 2];
        if (pos[i3 + 1] > 2.6) { this._write(i, 1); continue; }
        const inPond = pondSDF(px, pz) < -0.1;
        const ground = surfaceHeight(px, pz);
        if (inPond && ground < WATER_LEVEL && pos[i3 + 1] <= WATER_LEVEL + 0.01) {
          pos[i3 + 1] = WATER_LEVEL + 0.008;
          state[i] = WATER;
          timer[i] = 0;
          rot[i3] = rot[i3 + 2] = 0;
        } else if (pos[i3 + 1] <= ground + 0.01) {
          pos[i3 + 1] = ground + 0.012;
          state[i] = GROUND;
          timer[i] = 0;
          rot[i3] = (Math.random() - 0.5) * 0.3;
          rot[i3 + 2] = (Math.random() - 0.5) * 0.3;
        } else if (Math.abs(px) > 110 || Math.abs(pz) > 110) {
          this._spawn(i);
        }
        this._write(i, 1);
      } else if (state[i] === WATER) {
        // Drift slowly with the breeze and bob on the surface.
        wind.velocityAt(pos[i3], 0, pos[i3 + 2], w);
        pos[i3] += w.x * 0.06 * dt;
        pos[i3 + 2] += w.z * 0.06 * dt;
        rot[i3 + 1] += 0.1 * dt;
        pos[i3 + 1] = WATER_LEVEL + 0.008 + Math.sin(time * 2 + i) * 0.003;
        if (pondSDF(pos[i3], pos[i3 + 2]) > -0.2) { pos[i3] -= w.x * 0.06 * dt; pos[i3 + 2] -= w.z * 0.06 * dt; }
        const life = 22 / rainBoost;
        const fade = timer[i] > life ? Math.max(0, 1 - (timer[i] - life) / 3) : 1;
        this._write(i, fade);
        if (fade <= 0) this._spawn(i);
      } else {
        const life = 8 / rainBoost;
        const fade = timer[i] > life ? Math.max(0, 1 - (timer[i] - life) / 2) : 1;
        this._write(i, fade);
        if (fade <= 0) this._spawn(i);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _write(i, scale) {
    const i3 = i * 3;
    this._p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
    this._q.setFromEuler(this._e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]));
    this._s.setScalar(this.size[i] * scale + 1e-4);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
  }
}

/** Small cupped petal with the characteristic notch at the tip. */
function petalGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.018);
  s.bezierCurveTo(0.022, -0.012, 0.024, 0.012, 0.008, 0.024);
  s.lineTo(0, 0.018);
  s.lineTo(-0.008, 0.024);
  s.bezierCurveTo(-0.024, 0.012, -0.022, -0.012, 0, -0.018);
  const g = new THREE.ShapeGeometry(s, 3);
  g.rotateX(-Math.PI / 2);
  // Cup it slightly.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setY(i, x * x * 8);
  }
  g.computeVertexNormals();
  return g;
}
