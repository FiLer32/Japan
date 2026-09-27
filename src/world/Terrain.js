import * as THREE from 'three';
import { noise } from '../utils/noise.js';
import { smoothstep } from '../utils/math.js';
import { terrainHeight, pondSDF, getOccupancy, SAKURA, WORLD_HALF } from './layout.js';

/**
 * TERRAIN
 * -------
 * A displaced grid sampled from layout.terrainHeight() (flat garden, pond
 * basin, wooded hills) and painted with vertex colours: grass variation,
 * worn earth along paths, mud around the pond, petal-dusted ground under the
 * cherry trees. A tiling detail texture adds close-up texture on top.
 * Distant mountain ridges close off the horizon.
 */
export function createTerrain(materials, quality) {
  const group = new THREE.Group();
  group.name = 'terrain';

  const size = WORLD_HALF * 2;
  const seg = quality.terrainSegments;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const occ = getOccupancy();

  const grassA = new THREE.Color(0x4c6a2a);
  const grassB = new THREE.Color(0x71843a);
  const moss = new THREE.Color(0x3b5528);
  const dirt = new THREE.Color(0x8a7355);
  const mud = new THREE.Color(0x4a3e2e);
  const bottom = new THREE.Color(0x2f3526);
  const forest = new THREE.Color(0x344326);
  const petal = new THREE.Color(0xe6b8c4);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    // Grass variation.
    const n1 = noise.fbm2(x * 0.06, z * 0.06, 3) * 0.5 + 0.5;
    const n2 = noise.noise2(x * 0.35 + 50, z * 0.35) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, n1).lerp(moss, smoothstep(0.55, 0.9, n2) * 0.6);

    // Forest floor on the hills.
    const r = Math.hypot(x - 4, z - 2);
    c.lerp(forest, smoothstep(55, 75, r));

    // Worn earth next to paths.
    const pd = occ.pathDistance(x, z);
    c.lerp(dirt, (1 - smoothstep(-0.3, 1.1, pd)) * 0.85);

    // Fallen petals under cherry trees.
    for (const t of SAKURA) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < 7) c.lerp(petal, (1 - smoothstep(1.5, 7, d)) * 0.35 * (0.6 + 0.4 * n2));
    }

    // Pond bank and bed.
    const sd = pondSDF(x, z);
    if (sd < 1.8) {
      c.lerp(mud, 1 - smoothstep(0.2, 1.8, sd));
      if (sd < 0) c.copy(mud).lerp(bottom, smoothstep(0, 2.5, -sd));
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(geo, materials.ground);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  group.add(createMountains());
  return group;
}

/** Layered, fog-softened mountain ridges far beyond the garden. */
function createMountains() {
  const group = new THREE.Group();
  group.name = 'mountains';
  const layers = [
    { r0: 215, r1: 275, h: 42, color: 0x27352f, seed: 0 },
    { r0: 295, r1: 385, h: 85, color: 0x2e3a44, seed: 10 },
  ];
  for (const L of layers) {
    const seg = 160, rings = 6;
    const positions = [];
    const index = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const r = L.r0 + (L.r1 - L.r0) * t;
        const ridge = Math.pow(Math.abs(noise.fbm2(Math.cos(a) * 2.2 + L.seed, Math.sin(a) * 2.2 + L.seed, 5)), 0.8);
        const prof = Math.sin(t * Math.PI) * 0.7 + t * 0.3;
        const y = -6 + prof * L.h * (0.35 + ridge * 1.2);
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + seg + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: L.color, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
  }
  return group;
}
