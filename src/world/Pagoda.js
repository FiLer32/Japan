import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';
import { createRoof } from './roof.js';
import { PAGODA } from './layout.js';

/**
 * FIVE-STOREY PAGODA (gojū-no-tō)
 * ------------------------------
 * Each storey is a little narrower than the one below and carries its own
 * deep, upturned pyramid roof with rafters. Vermilion posts and beams frame
 * white plaster walls; the central bay on each side is a studded door.
 * A bronze sōrin finial (nine rings, water-flame and jewel) crowns it.
 */
export function createPagoda(materials) {
  const M = materials;
  const root = new THREE.Group();
  root.name = 'pagoda';
  root.position.set(PAGODA.x, 0, PAGODA.z);
  const b = new GeometryBatcher();

  // Stone platform + steps.
  b.box(M.stoneLight, 9, 0.7, 9, 0, 0.35, 0);
  b.box(M.stone, 9.3, 0.08, 9.3, 0, 0.72, 0);
  for (let k = 0; k < 3; k++) {
    const h = (0.72 * (k + 1)) / 3;
    b.box(M.stoneLight, 2.6, h, 0.4, 0, h / 2, 4.5 + 0.4 * (2 - k) + 0.2);
  }

  const tiers = 5;
  let baseY = 0.76;
  const roofs = [];
  for (let i = 0; i < tiers; i++) {
    const half = 2.7 - 0.24 * i;               // half-width of the storey body
    const bodyH = i === 0 ? 2.5 : 1.55;
    const overhang = 2.15 - 0.07 * i;

    // Body: plaster core, vermilion frame.
    b.box(M.plaster, half * 2 - 0.1, bodyH, half * 2 - 0.1, 0, baseY + bodyH / 2, 0);
    const posts = i === 0 ? [-1, -1 / 3, 1 / 3, 1] : [-1, 0, 1];
    for (const sx of [-1, 1]) {
      for (const p of posts) {
        b.box(M.woodVermilion, 0.22, bodyH, 0.22, p * (half - 0.05), baseY + bodyH / 2, sx * (half - 0.02));
        b.box(M.woodVermilion, 0.22, bodyH, 0.22, sx * (half - 0.02), baseY + bodyH / 2, p * (half - 0.05));
      }
    }
    // Beams top & bottom, all four sides.
    for (const yy of [baseY + 0.08, baseY + bodyH - 0.12]) {
      for (const sx of [-1, 1]) {
        b.box(M.woodVermilion, half * 2 + 0.1, 0.18, 0.2, 0, yy, sx * half);
        b.box(M.woodVermilion, 0.2, 0.18, half * 2 + 0.1, sx * half, yy, 0);
      }
    }
    // Doors (centre) and lattice windows (sides) on each face.
    for (let f = 0; f < 4; f++) {
      const ang = (f * Math.PI) / 2;
      const c = Math.round(Math.cos(ang)), s = Math.round(Math.sin(ang));
      const doorW = i === 0 ? 1.4 : 1.0;
      const doorH = bodyH * 0.72;
      const px = s * (half + 0.02), pz = c * (half + 0.02);
      b.box(M.woodVermilion, c ? doorW : 0.06, doorH, s ? doorW : 0.06, px, baseY + 0.2 + doorH / 2, pz);
      // Gold studs.
      for (let r = 0; r < 3; r++) {
        for (const k of [-0.25, 0.25]) {
          const off = k * doorW;
          b.add(STUD, M.gold, [px + c * off + s * 0.04, baseY + 0.4 + r * doorH * 0.33, pz - s * off + c * 0.04], [0, 0, 0], [0.04, 0.04, 0.04]);
        }
      }
      if (i === 0) {
        for (const k of [-1, 1]) {
          const off = k * half * 0.66;
          b.box(M.lacquerBlack, c ? 0.8 : 0.05, 0.9, s ? 0.8 : 0.05, px + c * off, baseY + 1.3, pz - s * off);
        }
      }
    }

    // Bracket clusters under the eaves (three-step mitesaki, simplified).
    const bY = baseY + bodyH;
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        if (sx === 0 && sz === 0) continue;
        const x = sx * half, z = sz * half;
        b.box(M.woodVermilion, 0.42, 0.22, 0.42, x, bY + 0.11, z);
        const out = new THREE.Vector3(sx, 0, sz).normalize();
        for (let k = 0; k < 3; k++) {
          const a = new THREE.Vector3(x, bY + 0.22 + k * 0.08, z).addScaledVector(out, -0.2);
          const e = new THREE.Vector3(x, bY + 0.22 + k * 0.08, z).addScaledVector(out, 0.35 + k * 0.22);
          b.beam(M.woodVermilion, a, e, 0.2, 0.08);
          b.box(M.woodVermilion, 0.22, 0.08, 0.22, e.x, e.y + 0.08, e.z);
        }
      }
    }
    b.box(M.woodVermilion, half * 2 + 0.5, 0.2, half * 2 + 0.5, 0, bY + 0.6, 0);  // eave purlin frame

    // Roof.
    const D = half + overhang;
    const roof = createRoof({
      W: D, D, H: D * 0.7, s0: 1, lift: 0.75 - i * 0.05, thickness: 0.28,
      rafters: overhang / D, rafterMaterial: M.woodVermilion,
      segS: 16, segT: 20,
    }, M);
    const sWall = overhang / D;
    roof.group.position.y = bY + 1.05 - roof.profile(sWall) + 0.34;
    root.add(roof.group);
    roofs.push(roof);

    // Next storey starts where the roof slope meets its footprint.
    if (i < tiers - 1) {
      const nextHalf = 2.7 - 0.24 * (i + 1);
      const sNext = 1 - nextHalf / D;
      baseY = roof.group.position.y + roof.profile(sNext) - 0.05;
      // Small balcony deck ring (koshi) visible between roofs.
      b.box(M.woodVermilion, nextHalf * 2 + 0.3, 0.14, nextHalf * 2 + 0.3, 0, baseY + 0.04, 0);
    } else {
      baseY = roof.group.position.y + roof.profile(1);
    }
  }

  // ---- Sōrin (spire) ---------------------------------------------------
  let y = baseY - 0.25;
  b.box(M.bronze, 0.95, 0.45, 0.95, 0, y + 0.22, 0);                 // roban
  y += 0.45;
  b.add(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.bronze, [0, y, 0]); // fukubachi
  y += 0.4;
  b.cylinder(M.bronze, 0.34, 0.2, 0.25, 0, y, 0, 12);                // ukebana (lotus)
  y += 0.25;
  b.cylinder(M.bronze, 0.07, 0.07, 4.2, 0, y, 0, 8);                 // shinbashira mast
  for (let r = 0; r < 9; r++) {
    const rad = 0.42 - r * 0.015;
    b.add(new THREE.TorusGeometry(rad, 0.055, 6, 18), M.bronze, [0, y + 0.2 + r * 0.3, 0], [Math.PI / 2, 0, 0]);
  }
  y += 2.95;
  const flame = new THREE.Shape();
  flame.moveTo(0, 0);
  flame.bezierCurveTo(0.45, 0.2, 0.25, 0.6, 0.05, 0.95);
  flame.bezierCurveTo(0.1, 0.6, -0.3, 0.55, 0, 0);
  const flameGeo = new THREE.ExtrudeGeometry(flame, { depth: 0.04, bevelEnabled: false });
  for (let k = 0; k < 4; k++) b.add(flameGeo, M.gold, [0, y, 0], [0, (k * Math.PI) / 2, 0], [0.7, 0.8, 0.7]); // suien
  y += 0.8;
  b.add(STUD, M.gold, [0, y, 0], [0, 0, 0], [0.16, 0.16, 0.16]);                                               // ryūsha
  b.add(new THREE.ConeGeometry(0.12, 0.35, 12), M.gold, [0, y + 0.3, 0]);                                    // hōju
  b.add(STUD, M.gold, [0, y + 0.22, 0], [0, 0, 0], [0.13, 0.13, 0.13]);

  root.add(b.build({ name: 'pagoda-structure' }));

  // Bronze wind bells (fūtaku) hanging from every roof corner.
  const bells = [];
  roofs.forEach((roof) => {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const bell = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 8, 1, true), M.bronze);
        bell.geometry.translate(0, -0.2, 0);
        bell.position.set(sx * roof.W * 0.97, roof.group.position.y + roof.y(0, 1) - 0.1, sz * roof.D * 0.97);
        bell.castShadow = true;
        root.add(bell);
        bells.push(bell);
      }
    }
  });

  const update = (dt, time) => {
    bells.forEach((bell, k) => {
      const s = Math.sin(time * 2.1 + k) * 0.12 + Math.sin(time * 3.7 + k * 2.3) * 0.06;
      bell.rotation.set(s, 0, s * 0.7);
    });
  };

  return { group: root, update };
}

const STUD = new THREE.SphereGeometry(1, 8, 6);
