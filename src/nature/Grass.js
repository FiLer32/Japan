import * as THREE from 'three';
import { applyWind } from './wind.js';
import { noise } from '../utils/noise.js';
import { createRNG } from '../utils/random.js';
import { smoothstep } from '../utils/math.js';
import { terrainHeight, pondSDF, getOccupancy } from '../world/layout.js';

/**
 * GRASS
 * -----
 * Tens of thousands of blades drawn with InstancedMesh, split into square
 * chunks so each chunk is frustum-culled on its own. Every frame a chunk's
 * visible instance count is reduced with camera distance (LOD); instances
 * are shuffled, so a prefix of the buffer is a uniform random subset.
 * Taller reeds grow in a band around the pond. Blades sway in the shared
 * wind field in the vertex shader.
 */
const CHUNK = 10;
const RADIUS = 57;
const CENTER = new THREE.Vector2(4, 2);

export class Grass {
  constructor(quality) {
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.chunks = [];
    this.lodScale = 1;

    const geo = bladeGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
    applyWind(mat, 'localPos.y * localPos.y * 0.75 * length(instanceMatrix[1].xyz)', {
      key: 'grass',
      vertexDecl: 'varying float vH;',
      vertexMain: 'vH = localPos.y;',
      patchFragment: (shader) => {
        // Point normals mostly upward so blades shade like a soft lawn.
        shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
          'vec3 objectNormal = normalize(normal * 0.35 + vec3(0.0, 1.0, 0.0));');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vH;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb *= mix(0.35, 1.08, vH);`)
          // Don't flip normals on back faces (keeps both sides lit alike).
          .replace('#include <normal_fragment_begin>', `
            float faceDirection = 1.0;
            vec3 normal = normalize(vNormal);
            vec3 nonPerturbedNormal = normal;`);
      },
    });
    this.material = mat;

    const occ = getOccupancy();
    const rng = createRNG(7);
    const density = quality.grassDensity;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();

    for (let cx = CENTER.x - RADIUS; cx < CENTER.x + RADIUS; cx += CHUNK) {
      for (let cz = CENTER.y - RADIUS; cz < CENTER.y + RADIUS; cz += CHUNK) {
        const items = [];
        const candidates = Math.floor(CHUNK * CHUNK * density);
        for (let i = 0; i < candidates; i++) {
          const x = cx + rng.next() * CHUNK, z = cz + rng.next() * CHUNK;
          const r = Math.hypot(x - CENTER.x, z - CENTER.y);
          if (r > RADIUS) continue;
          if (rng.next() > 1 - smoothstep(RADIUS - 8, RADIUS, r)) continue;
          if (occ.isBlocked(x, z)) continue;
          const pd = occ.pathDistance(x, z);
          if (pd < 0.15 || rng.next() > smoothstep(0.15, 0.9, pd)) continue;
          const sd = pondSDF(x, z);
          if (sd < 0.25) continue;
          const reed = sd < 1.6 && noise.noise2(x * 0.5, z * 0.5) > 0.05;
          // Patchy lawn: some areas thicker and taller than others.
          const patch = noise.fbm2(x * 0.09 + 3, z * 0.09, 3) * 0.5 + 0.5;
          if (!reed && rng.next() > 0.35 + patch * 0.8) continue;
          items.push({ x, z, reed, patch });
        }
        if (!items.length) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((it, i) => {
          p.set(it.x, terrainHeight(it.x, it.z) - 0.02, it.z);
          q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
          if (it.reed) {
            s.set(rng.range(0.9, 1.4), rng.range(0.7, 1.3), 1);
            c.setHSL(0.24 + rng.range(-0.02, 0.03), 0.5, rng.range(0.2, 0.3));
          } else {
            s.set(rng.range(0.8, 1.3), rng.range(0.18, 0.32) + it.patch * 0.28, 1);
            c.setHSL(0.21 + rng.range(-0.03, 0.04) + it.patch * 0.03, 0.45 + rng.range(0, 0.2), rng.range(0.24, 0.36));
          }
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, c);
        });
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.userData.total = items.length;
        mesh.userData.center = new THREE.Vector3(cx + CHUNK / 2, 0, cz + CHUNK / 2);
        this.group.add(mesh);
        this.chunks.push(mesh);
      }
    }
    this.bladeCount = this.chunks.reduce((a, ch) => a + ch.userData.total, 0);
  }

  /** Distance-based LOD: fewer blades in far chunks. */
  update(camera) {
    const cam = camera.position;
    let drawn = 0;
    for (const ch of this.chunks) {
      const d = cam.distanceTo(ch.userData.center);
      let f = d < 22 ? 1 : d < 45 ? 0.55 : d < 75 ? 0.28 : 0.12;
      f *= this.lodScale;
      ch.count = Math.max(1, Math.floor(ch.userData.total * Math.min(1, f)));
      drawn += ch.count;
    }
    this.drawn = drawn;
  }
}

/** A single curved, tapered blade of unit height (tip at y = 1). */
function bladeGeometry() {
  const segs = 4;
  const positions = [], uvs = [], index = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.035 * Math.pow(1 - t, 0.9) + 0.002;
    const bend = t * t * 0.18;
    if (i < segs) {
      positions.push(-w, t, bend, w, t, bend);
      uvs.push(0, t, 1, t);
    } else {
      positions.push(0, 1, bend);
      uvs.push(0.5, 1);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  index.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
