import * as THREE from 'three';
import { ColorRamp, ScalarRamp, kelvinToColor } from '../utils/color.js';
import { smoothstep, lerp } from '../utils/math.js';

/**
 * DAY CYCLE
 * ---------
 * Tracks the time of day (hours, 0-24) and derives every time-dependent
 * quantity from the sun's elevation: sky colours, sun colour temperature
 * (Kelvin), light intensities, star visibility, lantern level and exposure.
 *
 * The scene starts in the late afternoon so the default experience is the
 * sunset -> dusk -> night transition; the clock then keeps running through
 * the night and into the next day.
 */
const MAX_ELEVATION = THREE.MathUtils.degToRad(58);

// Sky colours keyed by sin(sun elevation).
const ZENITH = new ColorRamp([
  [-0.35, 0x010209], [-0.18, 0x030716], [-0.08, 0x0c1433], [0.0, 0x213766],
  [0.06, 0x2d5392], [0.18, 0x3b70bb], [0.4, 0x3673c6], [1.0, 0x2a61bb],
]);
const HORIZON = new ColorRamp([
  [-0.35, 0x05080f], [-0.18, 0x0e1628], [-0.08, 0x3a2b4d], [-0.02, 0x9a4a45], [0.0, 0xf0864a],
  [0.06, 0xffac62], [0.18, 0xf2cfa6], [0.4, 0xb4d2ec], [1.0, 0xa7cbef],
]);
const HEMI_INTENSITY = new ScalarRamp([[-0.3, 0.12], [-0.1, 0.18], [0.0, 0.45], [0.15, 0.85], [0.5, 1.1]]);
const EXPOSURE = new ScalarRamp([[-0.3, 1.45], [-0.08, 1.25], [0.05, 0.95], [0.3, 0.8]]);

export class DayCycle {
  constructor({ startHour = 17.25 } = {}) {
    this.hours = startHour;
    this.playing = true;
    /** Game minutes per real second (1 → one in-game hour per real minute). */
    this.baseRate = 1;
    this.speed = 1;

    this.state = {
      hours: this.hours,
      sunDir: new THREE.Vector3(),
      moonDir: new THREE.Vector3(),
      sunElevation: 0,
      daylight: 0,       // 0 night … 1 full day
      night: 0,          // 0 day … 1 deep night
      sunGlow: 1,
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      fogColor: new THREE.Color(),
      sunColor: new THREE.Color(),
      sunKelvin: 5500,
      sunIntensity: 0,
      moonColor: new THREE.Color(0.62, 0.72, 1.0),
      moonIntensity: 0,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 0,
      stars: 0,
      lanterns: 0,
      exposure: 1,
      phase: '',
    };
    this.update(0);
  }

  setHours(h) {
    this.hours = ((h % 24) + 24) % 24;
    this.update(0);
  }

  update(dt) {
    if (this.playing) this.hours = (this.hours + (dt * this.baseRate * this.speed) / 60) % 24;
    const s = this.state;
    s.hours = this.hours;

    // Sun travels east (+X) → south (+Z) → west (-X); below the horizon at night.
    const a = ((this.hours - 6) / 12) * Math.PI;
    s.sunDir.set(Math.cos(a), Math.sin(a) * Math.sin(MAX_ELEVATION), Math.sin(a) * Math.cos(MAX_ELEVATION)).normalize();
    // Moon roughly opposite, slightly offset so it is not exactly antipodal.
    s.moonDir.set(-s.sunDir.x * 0.95, -s.sunDir.y + 0.1, -s.sunDir.z * 0.6 - 0.25).normalize();

    const e = s.sunDir.y;
    s.sunElevation = e;
    s.daylight = smoothstep(-0.12, 0.25, e);
    s.night = 1 - smoothstep(-0.2, 0.02, e);

    ZENITH.sample(e, s.zenith);
    HORIZON.sample(e, s.horizon);
    // Colour the horizon more strongly on the sunset side of the sky.
    s.fogColor.copy(s.horizon).lerp(s.zenith, 0.25);

    // Colour temperature: deep orange at the horizon, neutral white at noon.
    s.sunKelvin = lerp(1700, 5800, smoothstep(-0.02, 0.45, e));
    kelvinToColor(s.sunKelvin, s.sunColor);
    s.sunIntensity = 3.4 * smoothstep(-0.015, 0.14, e);
    s.sunGlow = smoothstep(-0.12, 0.02, e);

    const moonUp = smoothstep(-0.02, 0.18, s.moonDir.y);
    s.moonIntensity = 0.42 * moonUp * s.night;

    s.hemiSky.copy(s.zenith).lerp(s.horizon, 0.45);
    // Keep a hint of blue moonlight in the ambient at night so it never goes black.
    s.hemiSky.lerp(new THREE.Color(0.18, 0.24, 0.42), s.night * 0.55);
    s.hemiGround.set(0x2e2a20).multiplyScalar(0.25 + 0.75 * s.daylight);
    s.hemiIntensity = HEMI_INTENSITY.sample(e);

    s.stars = smoothstep(-0.04, -0.2, e);
    s.lanterns = 1 - smoothstep(-0.03, 0.12, e);
    s.exposure = EXPOSURE.sample(e);

    const morning = this.hours < 12;
    if (e > 0.3) s.phase = 'Day';
    else if (e > 0.07) s.phase = morning ? 'Morning' : 'Golden hour';
    else if (e > -0.04) s.phase = morning ? 'Sunrise' : 'Sunset';
    else if (e > -0.18) s.phase = morning ? 'Dawn' : 'Dusk';
    else s.phase = 'Night';
    return s;
  }
}
