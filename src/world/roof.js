import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';

/**
 * CURVED JAPANESE ROOF
 * --------------------
 * Builds a tiled roof over a W x D (half-size) plan with:
 *  - a concave "sori" profile (shallow at the eaves, steep near the ridge),
 *  - upturned corners ("hanegi" lift),
 *  - either a pure hip roof (yosemune / pyramid: s0 = 1) or an
 *    irimoya hip-and-gable roof (s0 < 1): hipped skirt below, gables above,
 *  - fascia boards, soffit underside, exposed rafters, ridge & hip caps.
 *
 * Each face is parameterised by s (0 = eave → 1 = ridge) and t (-1 → 1 along
 * the eave). Faces are generated separately so hip lines stay crisp.
 * Local origin: centre of the plan at eave height.
 */
export function createRoof(opts, materials) {
  const {
    W, D, H,
    s0 = 1,                 // 1 = hip / pyramid, < 1 = irimoya
    lift = 0.7,             // corner upturn (m)
    thickness = 0.32,
    tileScale = 2.24,       // metres per texture repeat
    rafters = 0,            // s at the wall line (0 = no rafters)
    rafterMaterial = materials.woodDark,
    gableMaterial = materials.woodDark,
    ridgeHeight = 0.45,
    segS = 22, segT = 28,
  } = opts;

  const Wg = W - s0 * D;                        // half-width of the gable section
  const profile = (s) => H * (0.42 * s + 0.58 * s * s);
  const liftAt = (s, t) => lift * (1 - s) * (1 - s) * Math.pow(Math.abs(t), 4);
  const halfW = (s) => Math.max(W - s * D, Wg); // front/back face half-width
  const halfD = (s) => D * (1 - s);              // side face half-depth
  const y = (s, t) => profile(s) + liftAt(s, t);
  // Arc length along the slope, for tile UVs.
  const arc = [];
  { let acc = 0, prevY = 0, prevZ = D; const N = 64;
    for (let i = 0; i <= N; i++) {
      const s = i / N, yy = profile(s), zz = D * (1 - s);
      acc += Math.hypot(yy - prevY, zz - prevZ);
      arc.push(acc); prevY = yy; prevZ = zz;
    } }
  const arcAt = (s) => arc[Math.min(64, Math.round(s * 64))];

  const tileGeos = [], soffitGeos = [];
  const batch = new GeometryBatcher();

  // ---- Faces -----------------------------------------------------------
  const front = (s, t) => [t * halfW(s), y(s, t), halfD(s)];
  const side = (s, t) => [W - s * D, y(s, t), -t * halfD(s)];
  const sideMax = s0 < 1 ? Math.min(1, s0 + 0.35 / D) : 1;

  for (const rot of [0, Math.PI]) {
    tileGeos.push(faceGeometry(front, 1, segS, segT, (s, t, p) => [p[0] / tileScale, arcAt(s) / tileScale], rot));
    soffitGeos.push(faceGeometry(front, 1, segS, segT, (s, t, p) => [p[0] / 3, s * 2], rot, -thickness, true));
    tileGeos.push(faceGeometry(side, sideMax, segS, segT, (s, t, p) => [p[2] / tileScale, arcAt(s) / tileScale], rot));
    soffitGeos.push(faceGeometry(side, sideMax, segS, segT, (s, t, p) => [p[2] / 3, s * 2], rot, -thickness, true));
  }

  // ---- Fascia boards along the eaves -------------------------------------
  for (const rot of [0, Math.PI]) {
    batch.addMatrix(stripGeometry((t) => front(0, t), thickness, segT), materials.woodDark, rotY(rot));
    batch.addMatrix(stripGeometry((t) => side(0, t), thickness, segT), materials.woodDark, rotY(rot));
  }

  // ---- Ridge, hip and verge caps -----------------------------------------
  const capR = 0.13;
  const tube = (pts, r = capR) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 2), r, 6, false);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Hip line: from eave corner to s0.
      const hip = [];
      for (let i = 0; i <= 12; i++) {
        const s = (i / 12) * s0;
        hip.push(new THREE.Vector3(sx * (W - s * D), y(s, 1) + capR * 0.6, sz * halfD(s)));
      }
      batch.addMatrix(tube(hip), materials.roofRidge, IDENTITY);
      // Upturned tile end at the corner.
      batch.add(SPHERE, materials.roofRidge, [hip[0].x, hip[0].y + 0.05, hip[0].z], [0, 0, 0], [0.22, 0.2, 0.22]);
      if (s0 < 1) {
        // Gable verge from s0 to the ridge.
        const verge = [];
        for (let i = 0; i <= 10; i++) {
          const s = s0 + (i / 10) * (1 - s0);
          verge.push(new THREE.Vector3(sx * Wg, y(s, 1) + capR * 0.6, sz * halfD(s)));
        }
        batch.addMatrix(tube(verge), materials.roofRidge, IDENTITY);
      }
    }
  }
  const ridgeY = profile(1);
  const ridgeHalf = halfW(1);
  if (ridgeHalf > 0.05) {
    batch.box(materials.roofRidge, ridgeHalf * 2 + 0.3, ridgeHeight, 0.42, 0, ridgeY + ridgeHeight / 2 - 0.05, 0);
    batch.box(materials.roofRidge, ridgeHalf * 2 + 0.1, 0.12, 0.55, 0, ridgeY + ridgeHeight, 0);
    // Onigawara (ogre tiles) at the ridge ends, with a flared "shibi" fin.
    for (const sx of [-1, 1]) {
      batch.box(materials.roofRidge, 0.35, ridgeHeight + 0.55, 0.62, sx * (ridgeHalf + 0.15), ridgeY + (ridgeHeight + 0.55) / 2 - 0.1, 0);
      batch.add(SHIBI, materials.gold, [sx * (ridgeHalf + 0.1), ridgeY + ridgeHeight + 0.35, 0], [0, sx > 0 ? 0 : Math.PI, 0], [0.9, 0.9, 0.9]);
    }
  }

  // ---- Gable walls (irimoya only) ----------------------------------------
  if (s0 < 1) {
    const shape = new THREE.Shape();
    const N = 12;
    shape.moveTo(-halfD(s0), y(s0, 1) - 0.05);
    for (let i = 0; i <= N; i++) { const s = s0 + ((1 - s0) * i) / N; shape.lineTo(-halfD(s), y(s, 1) - 0.02); }
    for (let i = N; i >= 0; i--) { const s = s0 + ((1 - s0) * i) / N; shape.lineTo(halfD(s), y(s, 1) - 0.02); }
    const gable = new THREE.ShapeGeometry(shape);
    // ShapeGeometry lies in XY; turn so it spans Z/Y at x = ±(Wg - inset).
    const inset = 0.35;
    for (const sx of [-1, 1]) {
      const m = new THREE.Matrix4().makeRotationY(sx > 0 ? Math.PI / 2 : -Math.PI / 2).setPosition(sx * (Wg - inset), 0, 0);
      batch.addMatrix(gable, gableMaterial, m);
      // Decorative horizontal battens and a gold "gegyo" pendant.
      for (let k = 1; k <= 3; k++) {
        const s = s0 + ((1 - s0) * k) / 4;
        batch.box(gableMaterial, 0.08, 0.1, halfD(s) * 2, sx * (Wg - inset + 0.05), y(s, 1) - 0.25, 0);
      }
      batch.add(SPHERE, materials.gold, [sx * (Wg - inset + 0.1), y(1, 1) - 0.55, 0], [0, 0, 0], [0.12, 0.35, 0.3]);
    }
  }

  // ---- Exposed rafters (taruki) under the eaves ---------------------------
  if (rafters > 0) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const drop = thickness + 0.06;
    // Front/back: rafters run from the wall line out to the fascia.
    const nF = Math.floor((halfW(rafters) * 2) / 0.42);
    for (const rot of [0, Math.PI]) {
      const R = rotY(rot);
      for (let i = 0; i <= nF; i++) {
        const x = -halfW(rafters) + (i / nF) * halfW(rafters) * 2;
        const t0 = x / halfW(0), tA = x / halfW(rafters);
        a.set(x, y(0, t0) - drop, halfD(0) - 0.05).applyMatrix4(R);
        b.set(x, y(rafters, tA) - drop, halfD(rafters)).applyMatrix4(R);
        batch.beam(rafterMaterial, a, b, 0.09, 0.11);
      }
      const nS = Math.floor((halfD(rafters) * 2) / 0.42);
      for (let i = 0; i <= nS; i++) {
        const z = -halfD(rafters) + (i / nS) * halfD(rafters) * 2;
        a.set(W - 0.05, y(0, z / halfD(0)) - drop, z).applyMatrix4(R);
        b.set(W - rafters * D, y(rafters, z / halfD(rafters)) - drop, z).applyMatrix4(R);
        batch.beam(rafterMaterial, a, b, 0.09, 0.11);
      }
    }
  }

  // ---- Assemble -----------------------------------------------------------
  const group = batch.build({ name: 'roof-details' });
  const tiles = new THREE.Mesh(mergeSimple(tileGeos), materials.roofTile);
  tiles.castShadow = true;
  tiles.receiveShadow = true;
  const soffit = new THREE.Mesh(mergeSimple(soffitGeos), materials.soffit);
  soffit.receiveShadow = true;
  soffit.castShadow = false;
  group.add(tiles, soffit);
  group.name = 'roof';

  return { group, y, profile, halfW, halfD, W, D, H };
}

/* ------------------------------------------------------------------------- */

const IDENTITY = new THREE.Matrix4();
const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const SHIBI = (() => {
  // Stylised fish-tail ridge ornament.
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.15, 0.5, -0.05, 0.95);
  s.quadraticCurveTo(0.35, 0.7, 0.42, 0.25);
  s.quadraticCurveTo(0.35, 0.05, 0.2, 0);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  g.translate(0, 0, -0.09);
  return g;
})();

function rotY(a) { return new THREE.Matrix4().makeRotationY(a); }

/**
 * Grid surface from fn(s, t) → [x, y, z]. `uvFn(s, t, p)` gives UVs.
 * `offsetY` shifts the surface (soffit) and `flip` reverses winding.
 */
function faceGeometry(fn, sMax, segS, segT, uvFn, rot, offsetY = 0, flip = false) {
  const positions = [], uvs = [], index = [];
  for (let i = 0; i <= segS; i++) {
    const s = (i / segS) * sMax;
    for (let j = 0; j <= segT; j++) {
      const t = -1 + (2 * j) / segT;
      const p = fn(s, t);
      positions.push(p[0], p[1] + offsetY, p[2]);
      uvs.push(...uvFn(s, t, p));
    }
  }
  const row = segT + 1;
  for (let i = 0; i < segS; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * row + j, b = a + row;
      if (!flip) index.push(a, a + 1, b, a + 1, b + 1, b);
      else index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Guarantee the tile side faces up (and the soffit faces down).
  const ny = averageNormalY(g);
  if ((ny < 0) !== flip) {
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
    g.computeVertexNormals();
  }
  g.applyMatrix4(rotY(rot));
  return g;
}

function averageNormalY(g) {
  const n = g.attributes.normal;
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  return sum / n.count;
}

/** Vertical strip hanging below a curve (fascia board). */
function stripGeometry(edgeFn, height, seg) {
  const positions = [], uvs = [], index = [];
  for (let j = 0; j <= seg; j++) {
    const t = -1 + (2 * j) / seg;
    const p = edgeFn(t);
    positions.push(p[0], p[1] + 0.02, p[2], p[0], p[1] - height, p[2]);
    uvs.push(j / seg * 4, 0, j / seg * 4, 0.1);
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Face outwards (away from the roof centre).
  const n = g.attributes.normal, p = g.attributes.position;
  const mid = Math.floor(p.count / 2);
  if (n.getX(mid) * p.getX(mid) + n.getZ(mid) * p.getZ(mid) < 0) {
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
    g.computeVertexNormals();
  }
  return g;
}

function mergeSimple(geos) {
  // All faces share the same attribute layout; merge manually (no extra import).
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeBoundingSphere();
  return m;
}
