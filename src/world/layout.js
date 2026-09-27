import * as THREE from 'three';
import { noise } from '../utils/noise.js';
import { smoothstep, clamp, distToSegment2 } from '../utils/math.js';

/**
 * WORLD PLAN
 * ----------
 * Single source of truth for where everything lives. Units are metres,
 * +Y is up, the main hall faces +Z ("south"), the sun sets towards -X.
 *
 *              N (-Z)
 *     pagoda    HALL
 *        \       |        ~~~~ POND ~~~~
 *         \______|_____  bridge1   bridge2
 *                |
 *              TORII
 *              S (+Z)
 */

export const WATER_LEVEL = -0.25;
export const WORLD_HALF = 120;

export const HALL = { x: 0, z: -25 };           // podium 22 x 16, faces +Z
export const PAGODA = { x: -26, z: -7 };        // 5-storey pagoda, platform 9 x 9
export const TORII = { x: 0, z: 35 };
export const PLAZA = { minX: -10, maxX: 10, minZ: -16.5, maxZ: -7 }; // raked gravel forecourt

/** Pond: a wobbly ellipse. */
export const POND = { cx: 17, cz: 6, rx: 14, rz: 6.2 };

/** Arched bridges crossing the pond north-south. */
export const BRIDGES = [
  { x: 10, cz: 6, halfLength: 8.2, width: 2.3, rise: 2.1, style: 'vermilion' },
  { x: 24, cz: 6, halfLength: 7.8, width: 2.0, rise: 1.0, style: 'natural' },
];

/** Paths as 2D control points (x, z); smoothed with Catmull-Rom. */
export const PATHS = [
  { id: 'main', width: 3.2, type: 'gravel', points: [[0, 44], [0, 30], [0, 16], [0, 2], [0, -8], [0, -15]] },
  {
    id: 'pondLoop', width: 2.1, type: 'gravel',
    points: [[0, -4], [8, -3.8], [17, -4.4], [26, -3.6], [32.5, -1], [36.5, 5.5], [33.5, 12.5], [25, 16.4], [16, 17], [7, 16.3], [0, 15.5]],
  },
  { id: 'bridge1N', width: 1.8, type: 'gravel', points: [[10, -3.8], [10, -1.8]] },
  { id: 'bridge1S', width: 1.8, type: 'gravel', points: [[10, 13.8], [10, 16.4]] },
  { id: 'bridge2N', width: 1.6, type: 'gravel', points: [[24, -3.7], [24, -1.4]] },
  { id: 'bridge2S', width: 1.6, type: 'gravel', points: [[24, 13.4], [24, 16.5]] },
  { id: 'pagoda', width: 1.5, type: 'stones', points: [[-1, 6.4], [-9, 6.3], [-17, 3.2], [-26, -1.8]] },
];

/** Stone lanterns (tōrō). `light` = gets a real point light. */
export const LANTERNS = [
  { x: -2.9, z: 30, light: true }, { x: 2.9, z: 30, light: true },
  { x: -2.9, z: 20, light: true }, { x: 2.9, z: 20, light: true },
  { x: -4.2, z: -13.6, light: true }, { x: 4.2, z: -13.6, light: true },
  { x: 7.2, z: -6.3, light: true }, { x: 27.5, z: -6.3, light: true },
  { x: 39.2, z: 5.2, light: true }, { x: 21, z: 19.3, light: true },
  { x: 3.6, z: 18.8, light: true }, { x: -21.5, z: 3.6, light: true },
];

/** Cherry trees: position + scale + rotation seed. */
export const SAKURA = [
  { x: -8, z: 21, s: 1.0 }, { x: 8, z: 25.5, s: 1.1 }, { x: -11, z: -2, s: 0.95 },
  { x: -17, z: -17.5, s: 1.15 }, { x: 17, z: -10, s: 1.05 }, { x: 32, z: -8.5, s: 0.9 },
  { x: 40.5, z: 14, s: 1.0 }, { x: 15, z: 23.5, s: 0.95 }, { x: -15, z: 14, s: 1.1 },
  { x: 28.5, z: 22.5, s: 1.0 },
  // Two trees leaning over the water so petals drift onto the pond.
  { x: 4.5, z: 0.5, s: 0.95 }, { x: 28.5, z: 12.2, s: 0.9 },
];

/** Monk walking routes (closed loops of x, z control points). */
export const MONK_ROUTES = [
  // Around the pond (shares the main path between the two loop ends).
  { speed: 1.05, points: [[0, -4], [8, -3.8], [17, -4.4], [26, -3.6], [32.5, -1], [36.5, 5.5], [33.5, 12.5], [25, 16.4], [16, 17], [7, 16.3], [0, 15.5], [0, 6]] },
  // Rectangle that crosses both bridges.
  { speed: 0.9, points: [[10, -2.4], [10, 6], [10, 14.4], [12.5, 16.6], [17, 17], [21.5, 16.6], [24, 14.2], [24, 6], [24, -2.2], [21.5, -4], [17, -4.4], [12.5, -4]] },
  // Hall forecourt -> main path -> pagoda circuit -> back across the lawn.
  {
    speed: 1.0, points: [[0, -12], [0, -5], [0, 2], [-2, 6.4], [-9, 6.3], [-17, 3.2], [-21, 0.2], [-26, 0.9], [-31.5, -1], [-33.2, -7],
      [-31.5, -13.2], [-26, -14.6], [-20.5, -13.2], [-15, -11.2], [-8.5, -10.8], [-3.5, -11.2]],
  },
];

/* ------------------------------------------------------------------ */
/* Pond shape                                                          */
/* ------------------------------------------------------------------ */

/** Radius multiplier of the pond outline at polar angle theta. */
export function pondWobble(theta) {
  return 1 + 0.08 * Math.sin(3 * theta + 0.5) + 0.05 * Math.cos(5 * theta);
}

/**
 * Approximate signed distance (metres) to the pond outline.
 * Negative inside the water.
 */
export function pondSDF(x, z) {
  const nx = (x - POND.cx) / POND.rx;
  const nz = (z - POND.cz) / POND.rz;
  const theta = Math.atan2(nz, nx);
  const rho = Math.hypot(nx, nz);
  const c = Math.cos(theta), s = Math.sin(theta);
  const rEff = 1 / Math.sqrt((c * c) / (POND.rx * POND.rx) + (s * s) / (POND.rz * POND.rz));
  return (rho - pondWobble(theta)) * rEff;
}

/** Outline points of the pond, optionally grown outward by `expand` metres. */
export function pondOutline(segments = 128, expand = 0) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    const k = pondWobble(th);
    const c = Math.cos(th), s = Math.sin(th);
    const rEff = 1 / Math.sqrt((c * c) / (POND.rx * POND.rx) + (s * s) / (POND.rz * POND.rz));
    const grow = expand / rEff;
    pts.push(new THREE.Vector2(POND.cx + POND.rx * c * (k + grow), POND.cz + POND.rz * s * (k + grow)));
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Heights                                                             */
/* ------------------------------------------------------------------ */

/** Ground height (no bridges). */
export function terrainHeight(x, z) {
  const r = Math.hypot(x - 4, z - 2);
  let h = 0;

  // Gentle undulation that fades out near the built centre.
  h += noise.fbm2(x * 0.035, z * 0.035, 3) * 0.45 * smoothstep(28, 52, r);

  // Wooded hills rising around the garden.
  const hill = smoothstep(58, 100, r);
  h += hill * (5 + 9 * (noise.fbm2(x * 0.018 + 7, z * 0.018 - 3, 4) * 0.5 + 0.5));

  // Pond basin.
  const d = pondSDF(x, z);
  if (d < 0) {
    h = -0.38 - 1.1 * smoothstep(0, 3.2, -d) + noise.noise2(x * 0.4, z * 0.4) * 0.08;
  } else if (d < 1.6) {
    h = h * smoothstep(0, 1.6, d) - 0.38 * (1 - smoothstep(0, 1.6, d));
  }
  return h;
}

/** Deck height of a bridge at normalised position u in [-1, 1]. */
export function bridgeDeckY(bridge, u) {
  const k = clamp(1 - u * u, 0, 1);
  return 0.05 + bridge.rise * Math.pow(k, 0.85);
}

/** Walkable surface height: terrain, raised by bridge decks where present. */
export function surfaceHeight(x, z) {
  let h = terrainHeight(x, z);
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) <= b.width * 0.5 + 0.2 && Math.abs(z - b.cz) <= b.halfLength) {
      h = Math.max(h, bridgeDeckY(b, (z - b.cz) / b.halfLength) + 0.08);
    }
  }
  return h;
}

/* ------------------------------------------------------------------ */
/* Path curves                                                         */
/* ------------------------------------------------------------------ */

export function pathCurve(path) {
  const pts = path.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(pts, !!path.closed, 'centripetal', 0.5);
}

/** Pre-sampled path polylines used for distance queries. */
export const PATH_POLYLINES = PATHS.map((p) => {
  const curve = pathCurve(p);
  const n = Math.max(8, Math.ceil(curve.getLength() / 0.75));
  return { path: p, pts: curve.getSpacedPoints(n).map((v) => [v.x, v.z]) };
});

/** Distance to the nearest path edge (negative when on a path). */
export function pathEdgeDistance(x, z) {
  let best = Infinity;
  for (const { path, pts } of PATH_POLYLINES) {
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSegment2(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - path.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Occupancy grid                                                      */
/* ------------------------------------------------------------------ */

/**
 * A raster of the garden used for fast "can grass grow here?" and
 * "how close is the nearest path?" lookups during generation.
 * Each cell stores the distance to the nearest path edge (clamped).
 */
export class OccupancyGrid {
  constructor(half = 64, res = 0.25) {
    this.half = half;
    this.res = res;
    this.n = Math.ceil((half * 2) / res);
    this.pathDist = new Float32Array(this.n * this.n).fill(8);
    this.blocked = new Uint8Array(this.n * this.n);
    this._stampPaths();
    this._stampStructures();
  }

  _idx(x, z) {
    const i = Math.floor((x + this.half) / this.res);
    const j = Math.floor((z + this.half) / this.res);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  _stampPaths() {
    const R = 8; // metres of influence
    for (const { path, pts } of PATH_POLYLINES) {
      // Resample densely so stamps overlap.
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s];
        const [bx, bz] = pts[s + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len / (this.res * 2)));
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((bx - ax) * k) / steps;
          const z = az + ((bz - az) * k) / steps;
          this._stampDisc(x, z, R, path.width / 2);
        }
      }
    }
  }

  _stampDisc(cx, cz, R, radius) {
    const cells = Math.ceil(R / this.res);
    const ci = Math.floor((cx + this.half) / this.res);
    const cj = Math.floor((cz + this.half) / this.res);
    for (let j = cj - cells; j <= cj + cells; j++) {
      if (j < 0 || j >= this.n) continue;
      for (let i = ci - cells; i <= ci + cells; i++) {
        if (i < 0 || i >= this.n) continue;
        const x = (i + 0.5) * this.res - this.half;
        const z = (j + 0.5) * this.res - this.half;
        const d = Math.hypot(x - cx, z - cz) - radius;
        const idx = j * this.n + i;
        if (d < this.pathDist[idx]) this.pathDist[idx] = d;
      }
    }
  }

  _rect(minX, maxX, minZ, maxZ) {
    for (let z = minZ; z <= maxZ; z += this.res) {
      for (let x = minX; x <= maxX; x += this.res) {
        const idx = this._idx(x, z);
        if (idx >= 0) this.blocked[idx] = 1;
      }
    }
  }

  _stampStructures() {
    this._rect(HALL.x - 11.6, HALL.x + 11.6, HALL.z - 8.6, HALL.z + 10.8);
    this._rect(PAGODA.x - 5, PAGODA.x + 5, PAGODA.z - 5, PAGODA.z + 5);
    this._rect(PLAZA.minX, PLAZA.maxX, PLAZA.minZ, PLAZA.maxZ);
    for (const b of BRIDGES) {
      this._rect(b.x - b.width, b.x + b.width, b.cz - b.halfLength - 0.5, b.cz + b.halfLength + 0.5);
    }
    for (const l of LANTERNS) this._rect(l.x - 0.7, l.x + 0.7, l.z - 0.7, l.z + 0.7);
  }

  /** Distance to nearest path edge (metres, clamped to 8). */
  pathDistance(x, z) {
    const idx = this._idx(x, z);
    return idx < 0 ? 8 : this.pathDist[idx];
  }

  isBlocked(x, z) {
    const idx = this._idx(x, z);
    return idx < 0 ? false : this.blocked[idx] === 1;
  }
}

let _grid = null;
/** Lazily-built shared occupancy grid. */
export function getOccupancy() {
  if (!_grid) _grid = new OccupancyGrid();
  return _grid;
}
