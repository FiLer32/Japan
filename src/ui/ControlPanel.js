/**
 * CONTROL PANEL
 * -------------
 * Plain-DOM overlay for time of day, weather and quality toggles.
 * Keyboard: Space = play/pause time, 1/2/3/4 = clear/rain/fog/auto,
 * H = hide UI, R = reset camera, [ / ] = scrub time.
 */
const WEATHER_LABELS = { clear: 'Clear', rain: 'Rain', fog: 'Fog', auto: 'Auto' };

export class ControlPanel {
  constructor({ day, weather, onShadows, onBloom, onResetCamera, info, quality, onQuality }) {
    this.day = day;
    this.weather = weather;
    this.info = info;

    const el = document.createElement('div');
    el.className = 'panel';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Scene controls');
    el.innerHTML = `
      <div class="panel-header">
        <h2>Temple Garden</h2>
        <button class="icon-btn" data-act="collapse" title="Collapse panel" aria-label="Collapse panel">–</button>
      </div>
      <div class="panel-body">
        <div class="panel-section">
          <div class="panel-label"><span class="clock" data-ref="clock">17:20</span><span class="phase" data-ref="phase">Golden hour</span></div>
          <input type="range" min="0" max="1440" step="1" data-ref="time" aria-label="Time of day" />
          <div class="row" style="margin-top:8px">
            <button data-act="play" data-ref="play" style="flex:1">❚❚ Pause</button>
            <select data-ref="speed" aria-label="Time speed">
              <option value="0.25">¼×</option>
              <option value="1" selected>1×</option>
              <option value="4">4×</option>
              <option value="16">16×</option>
            </select>
          </div>
          <div class="row">
            <button data-act="sunset" style="flex:1" title="Jump to just before sunset">Sunset</button>
            <button data-act="night" style="flex:1" title="Jump to night">Night</button>
            <button data-act="noon" style="flex:1" title="Jump to midday">Day</button>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-label"><span>Weather</span><span class="phase" data-ref="weatherState"></span></div>
          <div class="seg" data-ref="weatherButtons">
            ${Object.entries(WEATHER_LABELS).map(([k, v]) => `<button data-weather="${k}">${v}</button>`).join('')}
          </div>
          <div class="meter" title="Rain"><div data-ref="rainMeter"></div></div>
          <div class="meter" title="Fog"><div data-ref="fogMeter" style="background:#9fb0c8"></div></div>
        </div>

        <div class="panel-section">
          <div class="panel-label"><span>Rendering</span><span class="stats" data-ref="stats"></span></div>
          <label class="toggle">Quality
            <select id="quality" data-ref="quality" aria-label="Graphics quality">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="toggle">Soft shadows <input type="checkbox" data-ref="shadows" checked /></label>
          <label class="toggle">Bloom glow <input type="checkbox" data-ref="bloom" checked /></label>
          <button data-act="camera" style="width:100%;margin-top:6px">Reset camera</button>
        </div>

        <div class="hint">
          Drag to orbit · right-drag / two fingers to pan · scroll to zoom<br />
          <kbd>Space</kbd> time · <kbd>1</kbd>–<kbd>4</kbd> weather · <kbd>[</kbd> <kbd>]</kbd> scrub · <kbd>H</kbd> hide UI · <kbd>R</kbd> camera
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    // Phones: start collapsed so the scene isn't hidden behind the sheet.
    if (window.innerWidth <= 640) {
      el.classList.add('collapsed');
      el.querySelector('[data-act="collapse"]').textContent = '+';
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
    this.toastEl = toast;

    this.refs = {};
    el.querySelectorAll('[data-ref]').forEach((n) => { this.refs[n.dataset.ref] = n; });

    // --- Wiring ----------------------------------------------------------
    const { refs } = this;
    refs.time.addEventListener('input', () => {
      this.day.setHours(Number(refs.time.value) / 60);
      this._scrubbing = true;
    });
    refs.time.addEventListener('change', () => { this._scrubbing = false; });
    refs.speed.addEventListener('change', () => { this.day.speed = Number(refs.speed.value); });
    refs.quality.value = quality;
    refs.quality.addEventListener('change', () => onQuality(refs.quality.value));
    refs.shadows.addEventListener('change', () => onShadows(refs.shadows.checked));
    refs.bloom.addEventListener('change', () => onBloom(refs.bloom.checked));

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.weather) this.setWeather(btn.dataset.weather);
      switch (btn.dataset.act) {
        case 'play': this.togglePlay(); break;
        case 'collapse':
          el.classList.toggle('collapsed');
          btn.textContent = el.classList.contains('collapsed') ? '+' : '–';
          break;
        case 'sunset': this.day.setHours(17.9); this.toast('Sunset'); break;
        case 'night': this.day.setHours(21.5); this.toast('Night'); break;
        case 'noon': this.day.setHours(12.5); this.toast('Midday'); break;
        case 'camera': onResetCamera(); break;
        default: break;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break;
        case 'Digit1': this.setWeather('clear'); break;
        case 'Digit2': this.setWeather('rain'); break;
        case 'Digit3': this.setWeather('fog'); break;
        case 'Digit4': this.setWeather('auto'); break;
        case 'KeyH': el.classList.toggle('hidden-ui'); break;
        case 'KeyR': onResetCamera(); break;
        case 'BracketLeft': this.day.setHours(this.day.hours - 0.25); break;
        case 'BracketRight': this.day.setHours(this.day.hours + 0.25); break;
        default: break;
      }
    });

    weather.onChange(() => this._syncWeather());
    this._syncWeather();
    this._syncPlay();
  }

  setWeather(mode) {
    if (mode === 'auto') this.weather.setAuto(true);
    else this.weather.setMode(mode);
    this.toast(mode === 'auto' ? 'Weather: automatic' : `Weather: ${WEATHER_LABELS[mode]}`);
  }

  togglePlay() {
    this.day.playing = !this.day.playing;
    this._syncPlay();
    this.toast(this.day.playing ? 'Time running' : 'Time paused');
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  _syncPlay() {
    this.refs.play.textContent = this.day.playing ? '❚❚ Pause' : '▶ Play';
  }

  _syncWeather() {
    const active = this.weather.auto ? 'auto' : this.weather.mode;
    this.refs.weatherButtons.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.weather === active || (this.weather.auto && b.dataset.weather === this.weather.mode));
    });
  }

  /** Per-frame refresh (cheap DOM writes, throttled). */
  update(dt, fps) {
    this._t = (this._t || 0) + dt;
    if (this._t < 0.2) return;
    this._t = 0;
    const s = this.day.state;
    const h = Math.floor(s.hours), m = Math.floor((s.hours - h) * 60);
    this.refs.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.refs.phase.textContent = s.phase;
    if (!this._scrubbing) this.refs.time.value = String(Math.round(s.hours * 60));
    const w = this.weather.state;
    this.refs.rainMeter.style.width = `${Math.round(w.rain * 100)}%`;
    this.refs.fogMeter.style.width = `${Math.round(w.fog * 100)}%`;
    this.refs.weatherState.textContent = this.weather.auto ? `auto · ${WEATHER_LABELS[this.weather.mode].toLowerCase()}` : '';
    const info = this.info();
    this.refs.stats.textContent = `${Math.round(fps)} fps · ${Math.round(info.pr * 100)}% res`;
  }
}
