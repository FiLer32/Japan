import * as THREE from 'three';
import { SimplexNoise } from '../utils/noise.js';

/**
 * Deformed-icosahedron boulders. A handful of variants are generated once
 * and reused through instancing (pond edge stones, garden feature rocks).
 */
export function createRockGeometry(seed, { detail = 2, flatten = 0.65, roughness = 0.35 } = {}) {
  const n = new SimplexNoise(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + n.fbm3(v.x * 1.3, v.y * 1.3, v.z * 1.3, 3) * roughness;
    v.multiplyScalar(d);
    v.y *= flatten;
    // Flat-ish underside so rocks sit on the ground.
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Planar UVs (the icosahedron seam UVs stretch badly after deformation).
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.5 + p.getZ(i) * 0.2, p.getY(i) * 0.5 + p.getZ(i) * 0.3);
  return g;
}
