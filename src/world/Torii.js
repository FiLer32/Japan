import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';
import { TORII } from './layout.js';

/**
 * TORII GATE (myōjin style) marking the entrance to the precinct:
 * two slightly battered vermilion pillars with black bases, a tie beam
 * (nuki), a central strut with a name plaque, and a double lintel
 * (kasagi over shimaki) whose ends sweep upward.
 */
export function createTorii(materials) {
  const M = materials;
  const b = new GeometryBatcher();
  const span = 2.75;
  const h = 5.8;

  for (const sx of [-1, 1]) {
    const pillar = new THREE.CylinderGeometry(0.28, 0.33, h, 18);
    b.add(pillar, M.woodVermilion, [sx * span, h / 2, 0], [0, 0, sx * 0.03]);
    b.cylinder(M.lacquerBlack, 0.38, 0.4, 0.55, sx * span, 0, 0, 18);       // kamaki (base sleeve)
    b.cylinder(M.stone, 0.5, 0.55, 0.12, sx * span, -0.02, 0, 12);
  }
  b.box(M.woodVermilion, span * 2 + 1.4, 0.34, 0.26, 0, 4.35, 0);             // nuki
  b.box(M.woodVermilion, 0.3, 1.0, 0.24, 0, 4.9, 0);                           // gakuzuka
  b.box(M.lacquerBlack, 0.75, 1.0, 0.1, 0, 4.95, 0.16);                        // plaque
  b.box(M.gold, 0.6, 0.85, 0.02, 0, 4.95, 0.22);

  // Upswept lintels: subdivided boxes bent along a parabola.
  const bent = (len, hh, d, rise) => {
    const g = new THREE.BoxGeometry(len, hh, d, 32, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (len / 2);
      p.setY(i, p.getY(i) + rise * x * x * x * x * 0.6 + rise * x * x * 0.4);
    }
    g.computeVertexNormals();
    return g;
  };
  b.add(bent(span * 2 + 2.6, 0.32, 0.5, 0.35), M.woodVermilion, [0, 5.55, 0]);   // shimaki
  b.add(bent(span * 2 + 3.2, 0.24, 0.62, 0.45), M.lacquerBlack, [0, 5.83, 0]);   // kasagi

  const group = b.build({ name: 'torii' });
  group.position.set(TORII.x, 0, TORII.z);
  return { group };
}
