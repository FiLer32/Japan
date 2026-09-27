import * as THREE from 'three';
import { clamp } from './math.js';

/**
 * Black-body colour temperature to linear RGB (Tanner Helland's fit).
 * Drives the sun's colour shift from ~1800K at the horizon to ~5800K at noon.
 */
export function kelvinToColor(kelvin, target = new THREE.Color()) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  // Values are sRGB-ish; convert so lighting math stays linear.
  return target.setRGB(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255, THREE.SRGBColorSpace);
}

/**
 * Piecewise-linear colour ramp keyed by a scalar (e.g. sun elevation).
 * keys: [{ at, color: THREE.Color }, ...] sorted ascending.
 */
export class ColorRamp {
  constructor(stops) {
    this.stops = stops.map(([at, hex]) => ({ at, color: new THREE.Color(hex) }));
  }
  sample(x, target = new THREE.Color()) {
    const s = this.stops;
    if (x <= s[0].at) return target.copy(s[0].color);
    for (let i = 1; i < s.length; i++) {
      if (x <= s[i].at) {
        const t = (x - s[i - 1].at) / (s[i].at - s[i - 1].at);
        return target.copy(s[i - 1].color).lerp(s[i].color, t);
      }
    }
    return target.copy(s[s.length - 1].color);
  }
}

/** Scalar version of ColorRamp. */
export class ScalarRamp {
  constructor(stops) { this.stops = stops; }
  sample(x) {
    const s = this.stops;
    if (x <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (x <= s[i][0]) {
        const t = (x - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t;
      }
    }
    return s[s.length - 1][1];
  }
}
