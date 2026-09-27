import * as THREE from 'three';
import { Renderer } from '../core/Renderer.js';
import { CameraRig } from '../core/CameraRig.js';
import { pickQuality } from './quality.js';
import { MaterialLibrary } from '../materials/MaterialLibrary.js';

import { Sky } from '../atmosphere/Sky.js';
import { DayCycle } from '../atmosphere/DayCycle.js';
import { Lighting } from '../atmosphere/Lighting.js';
import { Weather } from '../atmosphere/Weather.js';
import { Precipitation } from '../atmosphere/Precipitation.js';

import { createTerrain } from '../world/Terrain.js';
import { createPaths } from '../world/Paths.js';
import { createTemple } from '../world/Temple.js';
import { createPagoda } from '../world/Pagoda.js';
import { createTorii } from '../world/Torii.js';
import { createBridges } from '../world/Bridge.js';
import { createLanterns } from '../world/Lanterns.js';
import { Pond } from '../world/Pond.js';
import { getOccupancy } from '../world/layout.js';

import { windUniforms } from '../nature/wind.js';
import { Grass } from '../nature/Grass.js';
import { SakuraTrees } from '../nature/SakuraTrees.js';
import { Petals } from '../nature/Petals.js';
import { createForest } from '../nature/Forest.js';

import { KoiPond } from '../life/Koi.js';
import { Monks } from '../life/Monks.js';
import { Birds } from '../life/Birds.js';
import { Fireflies } from '../life/Fireflies.js';

import { ControlPanel } from '../ui/ControlPanel.js';

/**
 * APPLICATION
 * -----------
 * Owns the renderer, scene and every subsystem; builds the world in
 * progress-reported steps and runs the frame loop in a fixed order:
 *
 *   time → weather/day → lights & sky → animated systems → camera
 *   → water refraction pre-pass → composer (scene + bloom + output)
 */
export class App {
  constructor(container, overlay, support) {
    this.container = container;
    this.overlay = overlay;
    this.quality = pickQuality(support);
    this.clock = new THREE.Clock(false);
    this.time = 0;
    this.fps = 60;
    this.running = false;
  }

  async init() {
    const q = this.quality;
    const steps = [
      ['Preparing renderer', () => {
        this.gfx = new Renderer(this.container, q);
        this.renderer = this.gfx.renderer;
        this.renderer.info.autoReset = false;
        this.scene = new THREE.Scene();
        this.rig = new CameraRig(this.renderer.domElement);
        this.camera = this.rig.camera;
        this._handleContextLoss();
      }],
      ['Painting textures', () => { this.materials = new MaterialLibrary(this.renderer); }],
      ['Planning the garden', () => { getOccupancy(); }],
      ['Raising the sky', () => {
        this.day = new DayCycle();
        this.weather = new Weather();
        this.sky = new Sky();
        this.scene.add(this.sky.mesh);
        this.lighting = new Lighting(this.scene, q);
      }],
      ['Shaping the terrain', () => {
        this.scene.add(createTerrain(this.materials, q));
        this.scene.add(createPaths(this.materials));
      }],
      ['Building the main hall', () => {
        this.temple = createTemple(this.materials);
        this.scene.add(this.temple.group);
      }],
      ['Stacking the pagoda', () => {
        this.pagoda = createPagoda(this.materials);
        this.torii = createTorii(this.materials);
        this.scene.add(this.pagoda.group, this.torii.group);
      }],
      ['Crossing the pond', () => {
        this.scene.add(createBridges(this.materials));
        this.pond = new Pond(this.renderer, this.materials, q);
        this.scene.add(this.pond.group);
      }],
      ['Lighting the lanterns', () => {
        this.lanterns = createLanterns(this.materials, q);
        this.scene.add(this.lanterns.group);
      }],
      ['Growing cherry trees', () => {
        this.sakura = new SakuraTrees(this.materials, q);
        this.petals = new Petals(this.sakura.emitters, q);
        this.scene.add(this.sakura.group, this.petals.mesh);
      }],
      ['Sowing grass', () => {
        this.grass = new Grass(q);
        this.forest = createForest(this.materials, q);
        this.scene.add(this.grass.group, this.forest.group);
      }],
      ['Releasing the koi', () => {
        this.koi = new KoiPond(this.materials, this.pond, q);
        this.monks = new Monks(this.materials);
        this.birds = new Birds(q.birds);
        this.fireflies = new Fireflies(q.fireflies);
        this.precip = new Precipitation(this.scene, this.materials, q);
        this.scene.add(this.koi.group, this.monks.group, this.birds.group, this.fireflies.points);
      }],
      ['Compiling shaders', async () => {
        this.gfx.setupComposer(this.scene, this.camera);
        this._wireVisibilityLists();
        this._updateWorld(0);          // put every uniform in its initial state
        this.sky.updateEnvironment(this.renderer, this.scene, 0, true);
        if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
      }],
      ['Opening the gates', () => {
        this.panel = new ControlPanel({
          day: this.day,
          weather: this.weather,
          onShadows: (on) => this.gfx.setShadows(on, this.scene),
          onBloom: (on) => this.gfx.setBloom(on),
          onResetCamera: () => this.rig.reset(),
          info: () => this._lastInfo || { calls: 0 },
        });
        window.addEventListener('resize', () => this._resize());
      }],
    ];

    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      this.overlay.setProgress(i / steps.length, `${label}…`);
      // Yield so the progress bar can paint between heavy generation steps.
      await new Promise((r) => requestAnimationFrame(() => r()));
      await fn();
    }
    this.overlay.setProgress(1, 'Ready');
  }

  /** Objects skipped by the water's mirror and refraction passes. */
  _wireVisibilityLists() {
    this.pond.reflectionHidden.push(this.grass.group, this.precip.rain, this.precip.mist);
    this.refractionHidden = [
      this.sky.mesh, this.grass.group, this.sakura.group, this.petals.mesh, this.forest.group,
      this.birds.group, this.fireflies.points, this.precip.rain, this.precip.mist,
      this.pagoda.group, this.torii.group, this.monks.group,
    ];
  }

  start() {
    this.running = true;
    this.clock.start();
    this.overlay.hideLoader();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this._updateWorld(dt);

    this.renderer.info.reset();
    this.koi.setUnderwaterVisible(true);
    this.pond.renderRefraction(this.scene, this.camera, this.refractionHidden);
    this.koi.setUnderwaterVisible(false);
    this.gfx.render();
    this._lastInfo = { calls: this.renderer.info.render.calls };

    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this._adaptQuality(dt);
    this.panel.update(dt, this.fps);
  }

  /** Advance every subsystem by dt seconds. */
  _updateWorld(dt) {
    const t = this.time;
    windUniforms.uTime.value = t;

    const weather = this.weather.update(dt);
    const day = this.day.update(dt);
    this.lighting.update(day, weather, this.renderer);
    this.sky.update(day, weather, t, this.camera);
    this.sky.updateEnvironment(this.renderer, this.scene, dt);
    this.materials.setWetness(weather.wetness);

    this.temple.update(dt, t, day, weather);
    this.pagoda.update(dt, t);
    this.lanterns.update(dt, t, day, weather);
    this.pond.update(dt, t, day, weather, this.lighting.sun, this.lighting.hemi);
    this.koi.update(dt, t, day, weather);
    this.monks.update(dt, t, day);
    this.birds.update(dt, t, day, weather);
    this.fireflies.update(dt, t, day, weather);
    this.petals.update(dt, t, weather);
    this.precip.update(dt, t, this.camera, weather, day);

    this.rig.update(dt);
    this.grass.update(this.camera);

    // Glow blooms more at night and in mist.
    if (this.gfx.bloom) {
      this.gfx.bloom.strength = 0.28 + day.night * 0.32 + weather.fog * 0.2;
      this.gfx.bloom.threshold = 0.85 - day.night * 0.1;
    }
  }

  /**
   * Dynamic resolution: if the frame rate stays low, render fewer pixels and
   * thin the grass; recover when there is headroom again.
   */
  _adaptQuality(dt) {
    this._adaptTimer = (this._adaptTimer || 0) + dt;
    if (this._adaptTimer < 2.5) return;
    this._adaptTimer = 0;
    const r = this.renderer;
    const maxPR = Math.min(window.devicePixelRatio, this.quality.maxPixelRatio);
    const minPR = Math.max(0.6, maxPR * 0.5);
    let pr = r.getPixelRatio();
    if (this.fps < 38 && pr > minPR) pr = Math.max(minPR, pr - 0.15);
    else if (this.fps > 57 && pr < maxPR) pr = Math.min(maxPR, pr + 0.1);
    else {
      this.grass.lodScale = THREE.MathUtils.clamp(this.grass.lodScale + (this.fps < 38 ? -0.1 : this.fps > 55 ? 0.05 : 0), 0.4, 1);
      return;
    }
    r.setPixelRatio(pr);
    this.gfx.composer.setPixelRatio(pr);
    this._resize();
  }

  _resize() {
    this.gfx.resize(this.camera);
    this.pond.resize();
  }

  _handleContextLoss() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.renderer.setAnimationLoop(null);
      this.overlay.showError('Graphics context lost',
        'The GPU reset or the browser reclaimed the WebGL context.',
        'Reload the page to continue. If it keeps happening, try ?quality=low in the address bar.');
    });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }
}
