import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { createRNG } from '../utils/random.js';
import { noise } from '../utils/noise.js';
import { SAKURA, terrainHeight } from '../world/layout.js';

/**
 * CHERRY TREES (sakura)
 * ---------------------
 * Procedural, recursively branching trees with the wide umbrella crown of a
 * Somei-yoshino. The crown is two instanced layers:
 *  - soft noisy "blobs" that give the canopy volume and cast shadows,
 *  - alpha-tested blossom cards (painted five-petal flowers) that break up
 *    the silhouette.
 * Branches and blossoms share one height-based wind function, so they sway
 * together. Terminal branch points are exported as petal emitters.
 */
const WIND_FLEX = 'smoothstep(1.2, 8.0, wp.y) * 0.32';

export class SakuraTrees {
  constructor(materials, quality) {
    this.group = new THREE.Group();
    this.group.name = 'sakura';
    this.emitters = [];   // [{ x, y, z, tree }]
    const rng = createRNG(2024);

    const segments = [];  // { a, b, ra, rb }
    const blooms = [];    // { p: Vector3, s }

    SAKURA.forEach((t, ti) => {
      const base = new THREE.Vector3(t.x, terrainHeight(t.x, t.z) - 0.1, t.z);
      growTree(base, t.s, rng, segments, blooms, ti);
    });

    // ---- Branch mesh (all trees merged) ------------------------------------
    applyWind(materials.bark, WIND_FLEX, { key: 'bark' });
    this.branches = new THREE.Mesh(branchGeometry(segments), materials.bark);
    this.branches.castShadow = true;
    this.branches.receiveShadow = true;
    this.group.add(this.branches);

    // ---- Blossom blobs -----------------------------------------------------
    const blobGeo = blobGeometry();
    const blobMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: materials.blossomTexture });
    applyWind(blobMat, WIND_FLEX, {
      key: 'blob',
      patchFragment: (shader) => {
        // Fake subsurface: let a bit of light through the petals.
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.04;');
      },
    });
    const blobs = new THREE.InstancedMesh(blobGeo, blobMat, blooms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    blooms.forEach((b, i) => {
      q.setFromEuler(e.set(rng.next() * 6, rng.next() * 6, rng.next() * 6));
      s.set(b.s * rng.range(0.6, 0.85), b.s * rng.range(0.45, 0.62), b.s * rng.range(0.6, 0.85));
      m.compose(b.p, q, s);
      blobs.setMatrixAt(i, m);
      col.setHSL(0.94 + rng.range(-0.02, 0.015), rng.range(0.35, 0.6), rng.range(0.78, 0.88));
      blobs.setColorAt(i, col);
    });
    blobs.castShadow = true;
    blobs.receiveShadow = true;
    blobs.computeBoundingSphere();
    this.group.add(blobs);

    // ---- Blossom cards ------------------------------------------------------
    const cardsPer = quality.blossomCards;
    const cardGeo = new THREE.PlaneGeometry(1, 1);
    const cardMat = new THREE.MeshStandardMaterial({
      map: materials.blossomTexture, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8,
      color: 0xffffff,
    });
    applyWind(cardMat, WIND_FLEX, {
      key: 'card',
      patchFragment: (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
          // World "up" expressed in instance space (cards are randomly rotated).
          `vec3 upObj = normalize(vec3(0.0, 1.0, 0.0) * mat3(instanceMatrix));
           vec3 objectNormal = normalize(normal * 0.25 + upObj);`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 normal = normalize(vNormal);
          vec3 nonPerturbedNormal = normal;`);
      },
    });
    const cardCount = blooms.length * cardsPer;
    const cards = new THREE.InstancedMesh(cardGeo, cardMat, cardCount);
    const p = new THREE.Vector3();
    let n = 0;
    for (const b of blooms) {
      for (let k = 0; k < cardsPer; k++) {
        // Cards sit on the blob surface, biased to the top and outside.
        const dir = new THREE.Vector3(rng.gauss(0, 1), Math.abs(rng.gauss(0.4, 0.8)), rng.gauss(0, 1)).normalize();
        p.copy(b.p).addScaledVector(dir, b.s * rng.range(0.55, 0.95));
        q.setFromEuler(e.set(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI));
        s.setScalar(b.s * rng.range(0.8, 1.25));
        m.compose(p, q, s);
        cards.setMatrixAt(n, m);
        col.setHSL(0.965, rng.range(0.35, 0.7), rng.range(0.72, 0.88));
        cards.setColorAt(n, col);
        n++;
      }
    }
    cards.castShadow = true;
    cards.receiveShadow = true;
    cards.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: materials.blossomTexture, alphaTest: 0.35,
    });
    cards.computeBoundingSphere();
    this.group.add(cards);

    // Petal emitters: bloom centres.
    for (const b of blooms) this.emitters.push({ x: b.p.x, y: b.p.y, z: b.p.z, r: b.s, tree: b.tree });
  }
}

/** Recursive branching. */
function growTree(base, scale, rng, segments, blooms, treeIndex) {
  const trunkH = 2.1 * scale;
  const lean = new THREE.Vector3(rng.range(-0.15, 0.15), 1, rng.range(-0.15, 0.15)).normalize();
  const top = base.clone().addScaledVector(lean, trunkH);
  // Slight kink halfway up the trunk.
  const mid = base.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)));
  segments.push({ a: base, b: mid, ra: 0.3 * scale, rb: 0.25 * scale });
  segments.push({ a: mid, b: top, ra: 0.25 * scale, rb: 0.21 * scale });

  const branch = (start, dir, len, radius, depth) => {
    // Each branch is two slightly bent segments for a natural look.
    const bend = new THREE.Vector3(rng.gauss(0, 0.25), rng.gauss(-0.05, 0.12), rng.gauss(0, 0.25));
    const d1 = dir.clone().normalize();
    const midPt = start.clone().addScaledVector(d1, len * 0.5);
    const d2 = d1.clone().add(bend).normalize();
    // Outer branches droop a little.
    if (depth >= 2) d2.y -= 0.12;
    const end = midPt.clone().addScaledVector(d2.normalize(), len * 0.5);
    segments.push({ a: start, b: midPt, ra: radius, rb: radius * 0.85 });
    segments.push({ a: midPt, b: end, ra: radius * 0.85, rb: radius * 0.7 });

    if (depth >= 3) {
      blooms.push({ p: end.clone(), s: (0.75 + rng.next() * 0.35) * scale, tree: treeIndex });
      // A secondary bloom along the branch fills the crown.
      // (Kept sparse: every blob is drawn in the main, shadow and mirror passes.)
      if (rng.next() < 0.3) blooms.push({ p: midPt.clone().add(new THREE.Vector3(0, 0.25, 0)), s: 0.6 * scale, tree: treeIndex });
      return;
    }
    const children = depth === 0 ? 4 : rng.int(2, 3);
    for (let i = 0; i < children; i++) {
      const az = (i / children) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const spread = depth === 0 ? 0.95 : 0.6;
      const up = depth === 0 ? 0.75 : 0.45 + rng.range(-0.1, 0.2);
      const cd = d2.clone().multiplyScalar(0.55).add(new THREE.Vector3(Math.cos(az) * spread, up, Math.sin(az) * spread)).normalize();
      branch(end, cd, len * rng.range(0.66, 0.8), radius * 0.62, depth + 1);
    }
  };

  const mains = 3;
  for (let i = 0; i < mains; i++) {
    const az = (i / mains) * Math.PI * 2 + rng.next();
    const dir = new THREE.Vector3(Math.cos(az) * 0.8, 0.9, Math.sin(az) * 0.8);
    branch(top, dir, 2.2 * scale, 0.17 * scale, 0);
  }
}

/** Tapered open cylinders for every branch segment, merged. */
function branchGeometry(segments) {
  const radial = 7;
  const positions = [], normals = [], uvs = [], index = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  let offset = 0;
  for (const s of segments) {
    const dir = new THREE.Vector3().subVectors(s.b, s.a);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    for (let r = 0; r <= 1; r++) {
      const rad = r === 0 ? s.ra : s.rb;
      const c = r === 0 ? s.a : s.b;
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        v.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(q);
        normals.push(v.x, v.y, v.z);
        positions.push(c.x + v.x * rad, c.y + v.y * rad, c.z + v.z * rad);
        uvs.push(k / radial, (r * len) / 1.2);
      }
    }
    for (let k = 0; k < radial; k++) {
      const a = offset + k, b = offset + k + radial + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
    offset += (radial + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** Lumpy sphere for canopy volume (also used for clipped shrubs). */
export function blobGeometry(detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);           // weld so the lumps shade smoothly
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + noise.noise3(v.x * 2.2, v.y * 2.2, v.z * 2.2) * 0.22);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Spherical UVs so the canopy volume can carry the blossom texture.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    uv[i * 2] = (Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5) * 3;
    uv[i * 2 + 1] = (v.y * 0.5 + 0.5) * 1.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
