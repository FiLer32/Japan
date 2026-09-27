import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';
import { BRIDGES, bridgeDeckY, terrainHeight } from './layout.js';
import { GIBOSHI } from './Temple.js';

/**
 * ARCHED BRIDGES
 * --------------
 * - 'vermilion': a tall drum bridge (taiko-bashi) with lacquered railings
 *   and bronze giboshi finials.
 * - 'natural': a gentler, unpainted cedar bridge.
 * The deck follows layout.bridgeDeckY() exactly, which is also what the
 * monks use to walk over it.
 */
export function createBridges(materials) {
  const group = new THREE.Group();
  group.name = 'bridges';
  for (const bridge of BRIDGES) group.add(createBridge(bridge, materials));
  return group;
}

function createBridge(bridge, M) {
  const b = new GeometryBatcher();
  const painted = bridge.style === 'vermilion';
  const frame = painted ? M.woodVermilion : M.woodNatural;
  const deckMat = painted ? M.woodDark : M.woodFloor;
  const { x: bx, cz, halfLength: L, width: W } = bridge;
  const at = (u) => new THREE.Vector3(bx, bridgeDeckY(bridge, u), cz + u * L);

  // ---- Deck planks ------------------------------------------------------
  const samples = 200;
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(at(-1 + (2 * i) / samples));
  let arc = 0;
  const arcs = [0];
  for (let i = 1; i < pts.length; i++) { arc += pts[i].distanceTo(pts[i - 1]); arcs.push(arc); }
  const plankStep = 0.3;
  const uAtArc = (s) => {
    let i = arcs.findIndex((a) => a >= s);
    if (i <= 0) return -1;
    const t = (s - arcs[i - 1]) / (arcs[i] - arcs[i - 1]);
    return -1 + (2 * (i - 1 + t)) / samples;
  };
  for (let s = plankStep / 2; s < arc; s += plankStep) {
    const u = uAtArc(s);
    const p = at(u), q = at(Math.min(1, u + 0.01)), r = at(Math.max(-1, u - 0.01));
    const slope = Math.atan2(q.y - r.y, q.z - r.z);
    b.add(BOX, deckMat, [p.x, p.y - 0.04, p.z], [-slope, 0, 0], [W, 0.08, plankStep - 0.025]);
  }

  // ---- Stringers (side beams following the arch) -----------------------------
  const seg = 28;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < seg; i++) {
      const a = at(-1 + (2 * i) / seg), c = at(-1 + (2 * (i + 1)) / seg);
      a.x = c.x = bx + sx * (W / 2 + 0.06);
      a.y -= 0.16; c.y -= 0.16;
      b.beam(frame, a, c, 0.16, 0.34);
    }
  }

  // ---- Railings ----------------------------------------------------------------
  const railH = painted ? 0.95 : 0.8;
  const posts = painted ? 11 : 9;
  for (const sx of [-1, 1]) {
    const postPts = [];
    for (let i = 0; i < posts; i++) {
      const u = -0.96 + (1.92 * i) / (posts - 1);
      const p = at(u);
      p.x = bx + sx * (W / 2 - 0.02);
      postPts.push(p);
      b.box(frame, 0.14, railH, 0.14, p.x, p.y + railH / 2, p.z);
      if (painted && (i === 0 || i === posts - 1 || i === (posts - 1) / 2)) {
        b.add(GIBOSHI, M.bronze, [p.x, p.y + railH, p.z], [0, 0, 0], [1.1, 1.1, 1.1]);
      }
    }
    // Rails between posts: top rail + mid rail.
    for (let i = 0; i < posts - 1; i++) {
      for (const [hh, w, t] of [[railH - 0.06, 0.12, 0.09], [railH * 0.5, 0.07, 0.07]]) {
        const a = postPts[i].clone(), c = postPts[i + 1].clone();
        a.y += hh; c.y += hh;
        b.beam(frame, a, c, w, t);
      }
    }
  }

  // ---- Piers standing in the pond --------------------------------------------
  const piers = painted ? [-0.62, -0.2, 0.2, 0.62] : [-0.55, 0, 0.55];
  for (const u of piers) {
    const p = at(u);
    for (const sx of [-1, 1]) {
      const x = bx + sx * (W / 2 - 0.15);
      const ground = terrainHeight(x, p.z) - 0.2;
      const top = p.y - 0.3;
      b.cylinder(frame, 0.12, 0.13, top - ground, x, ground, p.z, 10);
    }
    b.box(frame, W + 0.3, 0.2, 0.2, bx, p.y - 0.3, p.z);   // cross beam
    b.box(frame, W, 0.12, 0.12, bx, p.y - 1.0, p.z);        // lower brace
  }

  return b.build({ name: `bridge-${bridge.style}` });
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
