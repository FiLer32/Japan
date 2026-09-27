import * as THREE from 'three';
import { createRNG } from '../utils/random.js';
import { PATHS, PLAZA, pathCurve, terrainHeight } from './layout.js';

/**
 * GARDEN PATHS
 * ------------
 * - Gravel paths: ribbons that follow Catmull-Rom curves and hug the terrain.
 * - Stepping-stone path (tobi-ishi) to the pagoda: instanced flat stones.
 * - Raked-gravel forecourt (karesansui style) in front of the main hall,
 *   framed by a granite curb.
 */
export function createPaths(materials) {
  const group = new THREE.Group();
  group.name = 'paths';

  // Pull the gravel slightly towards the camera in depth to avoid z-fighting.
  for (const m of [materials.gravel, materials.gravelRaked]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }

  for (const path of PATHS) {
    const curve = pathCurve(path);
    if (path.type === 'gravel') {
      const mesh = new THREE.Mesh(ribbonGeometry(curve, path.width), materials.gravel);
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      group.add(steppingStones(curve, materials.stoneLight));
    }
  }

  group.add(createPlaza(materials));
  return group;
}

/** Terrain-hugging strip along a curve, with softly irregular edges. */
function ribbonGeometry(curve, width) {
  const length = curve.getLength();
  const steps = Math.ceil(length / 0.4);
  const across = 4; // vertices across = across + 1
  const rng = createRNG(Math.round(length * 100));
  const positions = [], uvs = [], index = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    const nx = -tan.z, nz = tan.x; // left normal in XZ
    const wobbleL = rng.range(-0.08, 0.08), wobbleR = rng.range(-0.08, 0.08);
    for (let k = 0; k <= across; k++) {
      const s = k / across - 0.5;
      const edge = k === 0 ? wobbleL : k === across ? wobbleR : 0;
      const off = s * width + Math.sign(s) * edge;
      const x = p.x + nx * off, z = p.z + nz * off;
      // Slight crown in the middle, edges sink into the grass.
      const crown = 0.035 - Math.abs(s) * 0.05;
      positions.push(x, terrainHeight(x, z) + crown + 0.012, z);
      uvs.push((s + 0.5) * width / 1.6, (t * length) / 1.6);
    }
  }
  const row = across + 1;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k, b = a + row;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Make sure the strip faces up regardless of curve direction.
  if (geo.attributes.normal.getY(0) < 0) {
    geo.setIndex(index.map((_, i, arr) => arr[i - (i % 3) + (2 - (i % 3))]));
    geo.computeVertexNormals();
  }
  return geo;
}

/** Irregular flat stones laid along a curve. */
function steppingStones(curve, material) {
  const length = curve.getLength();
  const count = Math.floor(length / 0.9);
  const rng = createRNG(99);
  const base = new THREE.CylinderGeometry(0.5, 0.56, 0.16, 9, 1);
  // Irregular outline.
  const pos = base.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.08 * Math.cos(a * 5);
    pos.setXYZ(i, x * k, pos.getY(i), z * k * 0.8);
  }
  base.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(base, material, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    const side = (i % 2 === 0 ? 1 : -1) * rng.range(0.05, 0.22);
    p.x += -tan.z * side;
    p.z += tan.x * side;
    p.y = terrainHeight(p.x, p.z) + 0.03;
    q.setFromEuler(new THREE.Euler(rng.range(-0.03, 0.03), rng.next() * Math.PI, rng.range(-0.03, 0.03)));
    const sc = rng.range(0.8, 1.15);
    s.set(sc, 1, sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Raked gravel forecourt with a stone curb. */
function createPlaza(materials) {
  const group = new THREE.Group();
  const w = PLAZA.maxX - PLAZA.minX, d = PLAZA.maxZ - PLAZA.minZ;
  const cx = (PLAZA.minX + PLAZA.maxX) / 2, cz = (PLAZA.minZ + PLAZA.maxZ) / 2;
  const geo = new THREE.PlaneGeometry(w, d, 20, 10);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * d / 3);
  const plaza = new THREE.Mesh(geo, materials.gravelRaked);
  plaza.position.set(cx, 0.05, cz);
  plaza.receiveShadow = true;
  group.add(plaza);

  // Curb stones.
  const curbGeo = new THREE.BoxGeometry(1, 1, 1);
  const curbs = [
    [cx, cz - d / 2, w + 0.3, 0.25],
    // Front curb is split to leave an opening for the main path.
    [PLAZA.minX + (w / 2 - 1.8) / 2, cz + d / 2, w / 2 - 1.8, 0.25],
    [PLAZA.maxX - (w / 2 - 1.8) / 2, cz + d / 2, w / 2 - 1.8, 0.25],
    [cx - w / 2, cz, 0.25, d], [cx + w / 2, cz, 0.25, d],
  ];
  for (const [x, z, sx, sz] of curbs) {
    const c = new THREE.Mesh(curbGeo, materials.stone);
    c.position.set(x, 0.07, z);
    c.scale.set(sx, 0.18, sz);
    c.receiveShadow = true;
    c.castShadow = true;
    group.add(c);
  }
  return group;
}
