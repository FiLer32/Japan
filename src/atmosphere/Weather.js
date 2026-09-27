import { damp, smoothstep } from '../utils/math.js';
import { wind } from '../nature/wind.js';

/**
 * WEATHER STATE MACHINE
 * ---------------------
 * Modes: clear, rain, fog. Switching sets targets; the actual parameters
 * glide towards them over several seconds, so transitions are gradual.
 * In "auto" mode the weather picks a new state every minute or two.
 *
 * Outputs (0..1): rain, fog, overcast, wetness — plus the shared wind field.
 */
const PRESETS = {
  clear: { rain: 0, fog: 0, overcast: 0.05, wind: 0.35 },
  rain: { rain: 1, fog: 0.28, overcast: 1, wind: 0.85 },
  fog: { rain: 0, fog: 1, overcast: 0.6, wind: 0.12 },
};

export class Weather {
  constructor() {
    this.mode = 'clear';
    this.auto = false;
    this.state = { rain: 0, fog: 0, overcast: 0.05, wetness: 0, wind: 0.35 };
    this.target = { ...PRESETS.clear };
    this._autoTimer = 60;
    this._time = 0;
    this._listeners = [];
  }

  onChange(fn) { this._listeners.push(fn); }

  setMode(mode, { fromAuto = false } = {}) {
    if (!PRESETS[mode]) return;
    this.mode = mode;
    this.target = { ...PRESETS[mode] };
    if (!fromAuto) this.auto = false;
    this._listeners.forEach((fn) => fn(this));
  }

  setAuto(enabled) {
    this.auto = enabled;
    this._autoTimer = 25;
    this._listeners.forEach((fn) => fn(this));
  }

  update(dt) {
    this._time += dt;
    const s = this.state, t = this.target;

    if (this.auto) {
      this._autoTimer -= dt;
      if (this._autoTimer <= 0) {
        const options = ['clear', 'clear', 'rain', 'fog'].filter((m) => m !== this.mode);
        this.setMode(options[Math.floor(Math.random() * options.length)], { fromAuto: true });
        this._autoTimer = 55 + Math.random() * 50;
      }
    }

    // Gradual transitions (~5-8 s). Fog lingers a little longer than rain.
    s.rain = damp(s.rain, t.rain, 0.45, dt);
    s.fog = damp(s.fog, t.fog, 0.3, dt);
    s.overcast = damp(s.overcast, t.overcast, 0.4, dt);
    s.wind = damp(s.wind, t.wind, 0.5, dt);

    // Surfaces soak quickly and dry slowly.
    const wetTarget = smoothstep(0.05, 0.6, s.rain);
    s.wetness = wetTarget > s.wetness ? damp(s.wetness, wetTarget, 0.35, dt) : damp(s.wetness, wetTarget, 0.04, dt);

    // Wind: slowly veering direction plus gusts on top of the weather preset.
    const ang = 0.9 + Math.sin(this._time * 0.021) * 0.6 + Math.sin(this._time * 0.0071) * 0.4;
    wind.direction.set(Math.cos(ang), Math.sin(ang));
    wind.strength = s.wind * (0.85 + 0.15 * Math.sin(this._time * 0.23));
    return s;
  }
}
