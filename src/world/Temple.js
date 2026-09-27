import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';
import { createRoof } from './roof.js';
import { HALL } from './layout.js';

/**
 * MAIN HALL (hondō)
 * -----------------
 * Stone podium with front steps, raised wooden floor and veranda railing,
 * dark timber post-and-beam frame with stacked bracket sets (tokyō),
 * shōji sliding doors (centre bay slid open onto a candle-lit interior with
 * a gilded Buddha), plaster side/back walls and a large irimoya roof.
 *
 * Built in local space (front = +Z) and placed at HALL.
 */
const FLOOR_Y = 1.05;
const PILLAR_H = 4.3;
const PILLAR_R = 0.24;
const XS = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];   // pillar columns
const ZF = 4.5, ZB = -4.5;                         // front / back wall lines

export function createTemple(materials) {
  const root = new THREE.Group();
  root.name = 'main-hall';
  root.position.set(HALL.x, 0, HALL.z);

  const b = new GeometryBatcher();
  const M = materials;

  // ---- Podium & steps --------------------------------------------------
  b.box(M.stoneLight, 22, 0.85, 16, 0, 0.425, 0);
  b.box(M.stone, 22.4, 0.1, 16.4, 0, 0.88, 0);
  for (let k = 0; k < 5; k++) {
    const h = (0.93 * (k + 1)) / 5;
    b.box(M.stoneLight, 5.6, h, 0.4, 0, h / 2, 8 + 0.4 * (4 - k) + 0.2);
  }
  for (const sx of [-1, 1]) b.box(M.stone, 0.45, 0.95, 2.1, sx * 3.02, 0.475, 9.05);

  // ---- Floor deck -------------------------------------------------------
  b.box(M.woodFloor, 18.4, 0.14, 12.4, 0, FLOOR_Y - 0.07, 0);
  b.box(M.woodDark, 18.6, 0.2, 0.2, 0, FLOOR_Y - 0.12, 6.2);   // edge beams
  b.box(M.woodDark, 18.6, 0.2, 0.2, 0, FLOOR_Y - 0.12, -6.2);
  b.box(M.woodDark, 0.2, 0.2, 12.4, 9.2, FLOOR_Y - 0.12, 0);
  b.box(M.woodDark, 0.2, 0.2, 12.4, -9.2, FLOOR_Y - 0.12, 0);

  // ---- Veranda railing (kōran) ------------------------------------------
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      b.box(M.woodDark, 0.12, 0.8, 0.12, x, FLOOR_Y + 0.4, z);
    }
    const a = new THREE.Vector3(x0, FLOOR_Y + 0.82, z0), c = new THREE.Vector3(x1, FLOOR_Y + 0.82, z1);
    b.beam(M.woodDark, a, c, 0.12, 0.08);
    a.y = c.y = FLOOR_Y + 0.4;
    b.beam(M.woodDark, a, c, 0.06, 0.06);
  };
  rail(-9.1, -6.1, 9.1, -6.1);
  rail(-9.1, -6.1, -9.1, 6.1);
  rail(9.1, -6.1, 9.1, 6.1);
  rail(-9.1, 6.1, -2.9, 6.1);
  rail(2.9, 6.1, 9.1, 6.1);
  for (const [x, z] of [[-9.1, 6.1], [9.1, 6.1], [-9.1, -6.1], [9.1, -6.1], [-2.9, 6.1], [2.9, 6.1]]) {
    b.add(GIBOSHI, M.bronze, [x, FLOOR_Y + 0.86, z], [0, 0, 0], [1, 1, 1]);
  }

  // ---- Pillars -----------------------------------------------------------
  const pillars = [];
  for (const x of XS) { pillars.push([x, ZF], [x, ZB]); }
  for (const z of [-1.5, 1.5]) { pillars.push([XS[0], z], [XS[5], z]); }
  for (const [x, z] of pillars) {
    b.cylinder(M.woodDark, PILLAR_R, PILLAR_R * 1.05, PILLAR_H, x, FLOOR_Y, z, 14);
    b.cylinder(M.bronze, PILLAR_R * 1.12, PILLAR_R * 1.12, 0.12, x, FLOOR_Y, z, 14); // metal foot band
  }

  // ---- Horizontal beams: sill, door-head (nageshi), head tie ---------------
  const top = FLOOR_Y + PILLAR_H;
  const ring = (yy, h, d, mat = M.woodDark) => {
    b.box(mat, 15 + 0.5, h, d, 0, yy, ZF);
    b.box(mat, 15 + 0.5, h, d, 0, yy, ZB);
    b.box(mat, d, h, 9 + 0.5, XS[0], yy, 0);
    b.box(mat, d, h, 9 + 0.5, XS[5], yy, 0);
  };
  ring(FLOOR_Y + 0.08, 0.16, 0.34);
  ring(FLOOR_Y + 3.05, 0.26, 0.36);
  ring(top - 0.2, 0.3, 0.4);
  ring(top + 0.95, 0.34, 0.5);     // purlin (gagyō) above the brackets

  // ---- Bracket sets on every perimeter pillar -----------------------------
  for (const [x, z] of pillars) {
    const onFront = Math.abs(z) > 4;
    const onSide = Math.abs(x) > 7;
    b.box(M.woodDark, 0.6, 0.3, 0.6, x, top + 0.15, z);                                   // daito
    const dirs = [];
    if (onFront) dirs.push([1, 0]);
    if (onSide) dirs.push([0, 1]);
    for (const [dx, dz] of dirs) {
      b.box(M.woodDark, dx ? 1.7 : 0.3, 0.22, dz ? 1.7 : 0.3, x, top + 0.41, z);         // hijiki arm
      for (const k of [-0.6, 0, 0.6]) b.box(M.woodDark, 0.3, 0.2, 0.3, x + dx * k, top + 0.62, z + dz * k);
    }
    // Cantilevered arms reaching out to support the eaves.
    const out = new THREE.Vector3(onSide ? Math.sign(x) : 0, 0, onFront ? Math.sign(z) : 0).normalize();
    // (Kept below the soffit line so they never pierce the tiles.)
    const a = new THREE.Vector3(x, top + 0.62, z).addScaledVector(out, -0.3);
    const c = new THREE.Vector3(x, top + 0.12, z).addScaledVector(out, 1.5);
    b.beam(M.woodDark, a, c, 0.24, 0.26);
    b.box(M.woodDark, 0.32, 0.16, 0.32, c.x, c.y + 0.1, c.z);
  }

  // ---- Walls ---------------------------------------------------------------
  const wallH = 3.0 - 0.16;
  // Back wall + sides: plaster panels with a wooden wainscot.
  for (let i = 0; i < XS.length - 1; i++) {
    const cx = (XS[i] + XS[i + 1]) / 2;
    b.box(M.plaster, 2.52, wallH, 0.14, cx, FLOOR_Y + 0.16 + wallH / 2, ZB);
    b.box(M.woodDark, 2.52, 0.9, 0.18, cx, FLOOR_Y + 0.6, ZB);
    b.box(M.plaster, 2.52, 1.0, 0.14, cx, FLOOR_Y + 3.7, ZB);
    // Transom above the doors at the front.
    b.box(M.plaster, 2.52, 1.0, 0.14, cx, FLOOR_Y + 3.7, ZF);
  }
  for (const x of [XS[0], XS[5]]) {
    for (const [z0, z1] of [[-4.5, -1.5], [-1.5, 1.5], [1.5, 4.5]]) {
      const cz = (z0 + z1) / 2;
      b.box(M.plaster, 0.14, wallH, 2.52, x, FLOOR_Y + 0.16 + wallH / 2, cz);
      b.box(M.woodDark, 0.18, 0.9, 2.52, x, FLOOR_Y + 0.6, cz);
      b.box(M.plaster, 0.14, 1.0, 2.52, x, FLOOR_Y + 3.7, cz);
    }
  }

  // ---- Interior: ceiling, altar, statue, candles ----------------------------
  b.box(M.woodDark, 15, 0.12, 9, 0, top - 0.05, 0);
  for (let i = -6; i <= 6; i += 1.5) b.box(M.woodDark, 0.1, 0.12, 9, i, top - 0.15, 0); // coffer battens
  b.box(M.woodDark, 4.2, 0.9, 2.2, 0, FLOOR_Y + 0.45, -3.1);                            // altar platform
  b.box(M.gold, 4.3, 0.06, 2.3, 0, FLOOR_Y + 0.92, -3.1);
  addBuddha(b, M, 0, FLOOR_Y + 0.95, -3.3);

  const root2 = b.build({ name: 'hall-structure' });
  root.add(root2);

  // ---- Shōji sliding doors ---------------------------------------------------
  const doorGeo = new THREE.PlaneGeometry(1.5, 2.86);
  const doors = new THREE.Group();
  for (let i = 0; i < XS.length - 1; i++) {
    const cx = (XS[i] + XS[i + 1]) / 2;
    const centre = Math.abs(cx) < 0.1;
    for (const k of [-0.75, 0.75]) {
      const d = new THREE.Mesh(doorGeo, M.shoji);
      // The centre bay is slid open: its panels tuck behind their neighbours.
      const x = centre ? cx + k * 3 : cx + k;
      d.position.set(x, FLOOR_Y + 0.16 + 1.43, ZF + (centre ? -0.12 : -0.02));
      d.receiveShadow = true;
      doors.add(d);
    }
  }
  root.add(doors);

  // Candle flames (emissive) on the altar.
  const flameMat = M.lanternFire.clone();
  flameMat.emissive.set(0xffb060);
  const flames = new THREE.Group();
  for (const x of [-1.7, -1.2, 1.2, 1.7]) {
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), M.plaster);
    candle.position.set(x, FLOOR_Y + 1.12, -2.3);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), flameMat);
    f.scale.y = 1.8;
    f.position.set(x, FLOOR_Y + 1.36, -2.3);
    flames.add(candle, f);
  }
  root.add(flames);

  // Warm interior light: spills out of the open doors and through the shōji.
  const interior = new THREE.PointLight(0xffa050, 0, 13, 2);
  interior.position.set(0, FLOOR_Y + 2.3, -0.8);
  root.add(interior);

  // Hanging bronze lanterns (tsuri-dōrō) under the front eaves.
  const hanging = [];
  for (const x of [-5.9, 5.9]) {
    const g = new THREE.Group();
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), M.bronze);
    chain.position.y = 0.4;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.45, 6), M.lanternFire);
    body.position.y = -0.22;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.25, 6), M.bronze);
    cap.position.y = 0.1;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.18, 0.08, 6), M.bronze);
    bottom.position.y = -0.48;
    g.add(chain, body, cap, bottom);
    g.position.set(x, top + 0.1 - 0.8, ZF + 1.3);
    g.children.forEach((c) => { c.castShadow = true; });
    hanging.push(g);
    root.add(g);
  }

  // ---- Roof ------------------------------------------------------------------
  const overhang = 3.6;
  const roof = createRoof({
    W: 7.5 + overhang, D: 4.5 + overhang, H: 5.2, s0: 0.55, lift: 0.95,
    rafters: overhang / (4.5 + overhang), ridgeHeight: 0.55,
  }, M);
  roof.group.position.y = top + 1.12 - roof.profile(overhang / (4.5 + overhang)) + 0.38;
  root.add(roof.group);

  // ---- Per-frame animation -----------------------------------------------------
  const update = (dt, time, day, weather) => {
    const glow = day.lanterns;
    // Paper doors glow from within after dark (plus a hint in gloomy weather).
    M.shoji.emissiveIntensity = 0.04 + glow * 0.75 + weather.overcast * 0.1 * (1 - glow);
    const flicker = 0.85 + 0.1 * Math.sin(time * 11.3) + 0.05 * Math.sin(time * 23.7 + 1.3);
    flameMat.emissiveIntensity = 3.5 * flicker;
    interior.intensity = (1.2 + glow * 7) * flicker;
    for (const h of hanging) h.rotation.z = Math.sin(time * 0.9 + h.position.x) * 0.03 * (0.5 + weather.rain);
  };

  return { group: root, update, lights: [interior] };
}

/** Seated Buddha on a lotus pedestal with a flame-shaped halo. */
function addBuddha(b, M, x, y, z) {
  const lotus = new THREE.CylinderGeometry(0.85, 0.55, 0.45, 16);
  b.add(lotus, M.gold, [x, y + 0.22, z]);
  const petals = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(petals, M.gold, [x, y + 0.42, z], [Math.PI, 0, 0], [0.9, 0.25, 0.9]);
  // Crossed legs, torso, head, ushnisha.
  b.add(SPHERE, M.gold, [x, y + 0.72, z], [0, 0, 0], [0.75, 0.3, 0.55]);
  const torso = new THREE.CylinderGeometry(0.34, 0.5, 1.05, 14);
  b.add(torso, M.gold, [x, y + 1.3, z]);
  b.add(SPHERE, M.gold, [x, y + 1.72, z], [0, 0, 0], [0.48, 0.2, 0.36]);   // shoulders
  b.add(SPHERE, M.gold, [x, y + 2.05, z + 0.02], [0, 0, 0], [0.24, 0.29, 0.25]);
  b.add(SPHERE, M.gold, [x, y + 2.33, z + 0.02], [0, 0, 0], [0.13, 0.12, 0.13]);
  b.add(SPHERE, M.gold, [x, y + 0.95, z + 0.32], [0, 0, 0], [0.28, 0.1, 0.16]); // hands in lap
  // Halo (kōhai).
  const halo = new THREE.CircleGeometry(1, 24);
  b.add(halo, M.gold, [x, y + 1.85, z - 0.45], [0, 0, 0], [0.95, 1.25, 1]);
}

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
/** Onion-shaped bronze finial (giboshi). */
export const GIBOSHI = (() => {
  const pts = [];
  pts.push(new THREE.Vector2(0.001, 0));
  pts.push(new THREE.Vector2(0.09, 0));
  pts.push(new THREE.Vector2(0.09, 0.06));
  pts.push(new THREE.Vector2(0.06, 0.08));
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    pts.push(new THREE.Vector2(0.03 + Math.sin(a) * 0.075 * (1 - i / 14), 0.1 + i * 0.022));
  }
  pts.push(new THREE.Vector2(0.001, 0.32));
  return new THREE.LatheGeometry(pts, 10);
})();
