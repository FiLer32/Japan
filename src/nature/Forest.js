import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { createRNG } from '../utils/random.js';
import { terrainHeight, getOccupancy, pondSDF, SAKURA } from '../world/layout.js';
import { createRockGeometry } from '../world/rocks.js';
import { blobGeometry } from './SakuraTrees.js';

/**
 * FOREST & GARDEN PLANTING
 * ------------------------
 * - A ring of Japanese cedars (sugi) on the surrounding hills (instanced).
 * - A few cloud-pruned black pines (niwaki) inside the garden.
 * - Clipped azalea mounds (karikomi) along paths, some in bloom.
 * - Feature boulders set in the lawn.
 */
export function createForest(materials, quality) {
  const group = new THREE.Group();
  group.name = 'forest';
  const rng = createRNG(77);

  // ---- Cedars ----------------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.35, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const layers = [];
  for (let k = 0; k < 4; k++) {
    const r = 1.9 - k * 0.38, h = 3.2 - k * 0.35;
    const cone = new THREE.ConeGeometry(r, h, 8, 1);
    cone.translate(0, 3 + k * 1.9 + h / 2, 0);
    layers.push(cone.toNonIndexed());
  }
  const foliageGeo = mergeGeometries(layers);
  foliageGeo.computeVertexNormals();
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  applyWind(foliageMat, 'smoothstep(3.0, 16.0, localPos.y) * 0.12', { key: 'cedar' });
  const trunkMat = materials.bark;

  const count = quality.forestTrees;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(foliageGeo, foliageMat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count * 3 && placed < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 60 + Math.pow(rng.next(), 0.7) * 50;
    const x = 4 + Math.cos(a) * r, z = 2 + Math.sin(a) * r;
    // Keep the view down the entrance avenue open.
    if (z > 40 && Math.abs(x) < 7) continue;
    const sc = rng.range(1.1, 1.9);
    p.set(x, terrainHeight(x, z) - 0.3, z);
    q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
    s.set(sc, sc * rng.range(0.9, 1.25), sc);
    m.compose(p, q, s);
    crowns.setMatrixAt(placed, m);
    s.set(sc, sc * 3.4, sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(placed, m);
    c.setHSL(0.3 + rng.range(-0.04, 0.03), 0.35, rng.range(0.12, 0.2));
    crowns.setColorAt(placed, c);
    placed++;
  }
  trunks.count = crowns.count = placed;
  for (const im of [trunks, crowns]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---- Cloud-pruned pines ---------------------------------------------------
  const pineSpots = [[-15, -27], [15.5, -28], [36, -13], [-31, 13], [-6, 27]];
  const padGeo = new THREE.SphereGeometry(1, 12, 8);
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x2b4a2a, roughness: 0.9 });
  applyWind(pineMat, 'smoothstep(2.0, 7.0, wp.y) * 0.1', { key: 'pine' });
  const pads = [];
  const trunkParts = [];
  for (const [x, z] of pineSpots) {
    const base = new THREE.Vector3(x, terrainHeight(x, z), z);
    const pts = [base.clone()];
    let dir = new THREE.Vector3(rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5)).normalize();
    for (let k = 1; k <= 5; k++) {
      dir.add(new THREE.Vector3(rng.range(-0.5, 0.5), 0.1, rng.range(-0.5, 0.5))).normalize();
      pts.push(pts[k - 1].clone().addScaledVector(dir, 1.1));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.18, 7);
    trunkParts.push(tube);
    // Horizontal foliage pads at branch tips.
    for (let k = 2; k < pts.length; k++) {
      const ang = rng.next() * Math.PI * 2;
      const len = rng.range(0.8, 1.8);
      const tip = pts[k].clone().add(new THREE.Vector3(Math.cos(ang) * len, rng.range(-0.2, 0.3), Math.sin(ang) * len));
      trunkParts.push(new THREE.TubeGeometry(new THREE.LineCurve3(pts[k], tip), 2, 0.07, 5));
      pads.push({ p: tip.add(new THREE.Vector3(0, 0.25, 0)), s: rng.range(0.9, 1.4) });
    }
    pads.push({ p: pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.3, 0)), s: 1.3 });
  }
  const pineTrunks = new THREE.Mesh(mergeGeometries(trunkParts), materials.bark);
  pineTrunks.castShadow = pineTrunks.receiveShadow = true;
  group.add(pineTrunks);
  const padMesh = new THREE.InstancedMesh(padGeo, pineMat, pads.length);
  pads.forEach((pd, i) => {
    m.compose(pd.p, q.identity(), s.set(pd.s * 1.3, pd.s * 0.42, pd.s * 1.1));
    padMesh.setMatrixAt(i, m);
  });
  padMesh.castShadow = padMesh.receiveShadow = true;
  padMesh.computeBoundingSphere();
  group.add(padMesh);

  // ---- Azalea mounds -----------------------------------------------------------
  const occ = getOccupancy();
  const shrubGeo = blobGeometry();
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const shrubs = [];
  for (let i = 0; i < 1400 && shrubs.length < quality.shrubs; i++) {
    const x = rng.range(-40, 48), z = rng.range(-34, 34);
    const pd = occ.pathDistance(x, z);
    if (pd < 0.9 || pd > 3.5 || occ.isBlocked(x, z)) continue;
    if (pondSDF(x, z) < 1.4) continue;
    if (SAKURA.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
    if (shrubs.some((sh) => Math.hypot(sh.x - x, sh.z - z) < 2.2)) continue;
    shrubs.push({ x, z, s: rng.range(0.55, 1.1), bloom: rng.next() < 0.22 });
  }
  const shrubMesh = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubs.length);
  shrubs.forEach((sh, i) => {
    p.set(sh.x, terrainHeight(sh.x, sh.z) + sh.s * 0.25, sh.z);
    m.compose(p, q.setFromAxisAngle(up, rng.next() * 6), s.set(sh.s * 1.2, sh.s * 0.8, sh.s * 1.05));
    shrubMesh.setMatrixAt(i, m);
    if (sh.bloom) c.setHSL(0.95 + rng.range(-0.02, 0.02), 0.38, 0.42);
    else c.setHSL(0.28 + rng.range(-0.03, 0.03), 0.45, rng.range(0.16, 0.24));
    shrubMesh.setColorAt(i, c);
  });
  shrubMesh.castShadow = shrubMesh.receiveShadow = true;
  shrubMesh.computeBoundingSphere();
  group.add(shrubMesh);

  // ---- Feature rocks -----------------------------------------------------------
  const rockSpots = [[-6, -2, 1.4], [-7.5, -3.2, 0.8], [30, 20, 1.2], [38, -3, 1.0], [-20, 9, 1.1], [-35, -4, 1.5], [12, 21, 0.9]];
  const rockGeo = createRockGeometry(555, { roughness: 0.4 });
  const rocks = new THREE.InstancedMesh(rockGeo, materials.rock, rockSpots.length);
  rockSpots.forEach(([x, z, sc], i) => {
    p.set(x, terrainHeight(x, z) + sc * 0.2, z);
    m.compose(p, q.setFromAxisAngle(up, i * 1.3), s.set(sc * 1.3, sc, sc));
    rocks.setMatrixAt(i, m);
  });
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  return { group };
}
