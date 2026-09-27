import * as THREE from 'three';
import { lerp } from '../utils/math.js';

/**
 * LIGHTING RIG
 * ------------
 * - One shadow-casting DirectionalLight that represents whichever celestial
 *   body is brighter (sun by day, moon by night). Both are at the horizon
 *   when the hand-over happens, so the switch is invisible and we only pay
 *   for a single shadow map.
 * - HemisphereLight for sky/ground bounce.
 * - Exponential fog whose colour tracks the horizon.
 * Weather dims the sun, flattens colours and thickens the fog.
 */
const SHADOW_CENTER = new THREE.Vector3(6, 0, -2);

export class Lighting {
  constructor(scene, quality) {
    this.scene = scene;

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -56; cam.right = 56; cam.top = 56; cam.bottom = -56;
    cam.near = 1; cam.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    sun.target.position.copy(SHADOW_CENTER);
    scene.add(sun, sun.target);
    this.sun = sun;

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3020, 0.8);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0x9aaabb, 0.004);
    this._tmp = new THREE.Color();
    this._grey = new THREE.Color();
  }

  update(day, weather, renderer) {
    const sun = this.sun;
    const overcast = weather.overcast;

    // Pick the brighter celestial light.
    const sunI = day.sunIntensity * (1 - overcast * 0.88);
    const moonI = day.moonIntensity * (1 - overcast * 0.8);
    const useSun = sunI >= moonI;
    const dir = useSun ? day.sunDir : day.moonDir;
    sun.position.copy(SHADOW_CENTER).addScaledVector(dir, 120);
    sun.intensity = useSun ? sunI : moonI;
    sun.color.copy(useSun ? day.sunColor : day.moonColor);
    // Shadows soften (larger blur) as the light becomes diffuse.
    sun.shadow.radius = 2 + overcast * 6;

    // Hemisphere: sky colour desaturates towards grey under cloud.
    this._grey.setScalar(day.hemiSky.getHSL({}).l * 0.9 + 0.05);
    this.hemi.color.copy(day.hemiSky).lerp(this._grey, overcast * 0.6);
    this.hemi.groundColor.copy(day.hemiGround);
    this.hemi.intensity = day.hemiIntensity * (1 + overcast * 0.25);

    // Fog colour & density.
    const fog = this.scene.fog;
    this._tmp.copy(day.fogColor);
    const greyL = this._tmp.getHSL({}).l;
    this._grey.setRGB(greyL, greyL * 1.02, greyL * 1.06);
    fog.color.copy(this._tmp).lerp(this._grey, Math.min(1, overcast * 0.8));
    // Moonlit mist: keep dense fog faintly visible at night instead of pure black.
    const lift = weather.fog * 0.045 * day.night;
    fog.color.r = Math.max(fog.color.r, lift * 0.8);
    fog.color.g = Math.max(fog.color.g, lift * 0.9);
    fog.color.b = Math.max(fog.color.b, lift * 1.15);
    fog.density = 0.0032 + weather.fog * 0.036 + weather.rain * 0.009;

    // Weather-adjusted fog colour also feeds the sky shader's haze.
    day.fogColor.copy(fog.color);

    // Environment reflections scale with ambient brightness.
    this.scene.environmentIntensity = lerp(0.35, 1.0, day.daylight) * (1 - overcast * 0.3);

    // Simple "eye adaptation": expose more at night.
    renderer.toneMappingExposure = day.exposure * (1 + overcast * 0.12);
  }
}
