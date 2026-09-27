import * as THREE from 'three';

/**
 * SKY DOME
 * --------
 * A camera-centred inverted sphere with an analytic sky shader:
 * zenith/horizon gradient, sun disc + Mie-style glow, moon, twinkling stars
 * and scrolling fBm clouds whose coverage follows the weather.
 *
 * The same material is rendered into a PMREM environment map every so often
 * so PBR materials pick up matching ambient light / reflections.
 */
const vertexShader = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;                      // object space direction (sphere is centred on camera)
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;                 // push to far plane
}
`;

const fragmentShader = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoonGlow;
uniform float uStars;
uniform float uCloudCover;
uniform vec3 uCloudColor;
uniform vec3 uFogColor;
uniform float uFog;
uniform float uTime;
uniform float uDiscs;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // Base gradient: horizon -> zenith, darkening below the horizon.
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uGround, smoothstep(0.0, -0.15, h));

  // Sun: broad forward-scattering glow + warm horizon band + disc.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55) * uSunGlow;
  col += uSunColor * pow(sd, 2.0) * 0.35 * exp(-abs(h) * 7.0) * uSunGlow;
  float sunDisc = smoothstep(0.99955, 0.99975, sd) * smoothstep(-0.02, 0.01, h);
  col += uSunColor * sunDisc * 30.0 * uDiscs;

  // Moon: disc with subtle mare shading and a soft halo.
  float md = max(dot(d, uMoonDir), 0.0);
  float moonDisc = smoothstep(0.99962, 0.99978, md);
  vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec2 muv = vec2(dot(d - uMoonDir, mt), dot(d - uMoonDir, cross(mt, uMoonDir))) * 900.0;
  float mare = 0.75 + 0.25 * vnoise(muv * 0.5 + 3.0);
  col += uMoonColor * moonDisc * 4.0 * mare * uDiscs * smoothstep(-0.02, 0.02, h);
  col += uMoonColor * (pow(md, 400.0) * 0.4 + pow(md, 24.0) * 0.06) * uMoonGlow;

  // Stars: sparse cells on a sphere, twinkling.
  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 230.0;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash13(id);
    float star = step(0.986, r) * smoothstep(0.32, 0.0, length(f));
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + r * 6.0) + r * 91.0);
    vec3 starCol = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), fract(r * 37.0));
    col += starCol * star * tw * uStars * smoothstep(0.02, 0.25, h) * 2.0;
    // Faint milky band.
    float band = exp(-pow(dot(d, normalize(vec3(0.4, 0.3, -0.85))) * 4.0, 2.0));
    col += vec3(0.08, 0.09, 0.12) * band * fbm(d.xz * 12.0) * uStars * 0.6;
  }

  // Clouds: fBm on a virtual plane above the camera.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.15) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv);
    float cover = uCloudCover;
    float c = smoothstep(0.62 - cover * 0.5, 0.82 - cover * 0.3, n);
    c *= smoothstep(0.0, 0.2, h);
    float lit = pow(sd, 4.0) * uSunGlow;
    vec3 cloudCol = uCloudColor * (0.75 + 0.25 * n) + uSunColor * lit * 0.8;
    col = mix(col, cloudCol, c * (0.55 + cover * 0.4));
  }

  // Haze: fog swallows the horizon.
  float haze = uFog * (1.0 - smoothstep(-0.1, 0.45 + uFog * 0.4, h));
  col = mix(col, uFogColor, clamp(haze, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunGlow: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonColor: { value: new THREE.Color(0xc8d4ff) },
      uMoonGlow: { value: 0 },
      uStars: { value: 0 },
      uCloudCover: { value: 0.2 },
      uCloudColor: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFog: { value: 0 },
      uTime: { value: 0 },
      uDiscs: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(400, 48, 32);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';

    // Separate scene for environment-map capture.
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(geo, this.material));
    this._envTimer = 0;
    this._envRT = null;
    this._lastEnvKey = '';
  }

  /** Copy day-cycle + weather state into uniforms. */
  update(day, weather, time, camera) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uZenith.value.copy(day.zenith);
    u.uHorizon.value.copy(day.horizon);
    u.uGround.value.copy(day.horizon).multiplyScalar(0.35);
    u.uSunDir.value.copy(day.sunDir);
    u.uSunColor.value.copy(day.sunColor);
    u.uSunGlow.value = day.sunGlow * (1 - weather.overcast * 0.85);
    u.uMoonDir.value.copy(day.moonDir);
    u.uMoonGlow.value = day.night * (1 - weather.overcast * 0.9);
    u.uStars.value = day.stars * (1 - Math.min(1, weather.overcast * 1.4));
    u.uCloudCover.value = 0.25 + weather.overcast * 0.75;
    u.uCloudColor.value.copy(day.horizon).lerp(day.zenith, 0.35).multiplyScalar(0.9 + day.daylight * 0.4);
    u.uFogColor.value.copy(day.fogColor);
    u.uFog.value = Math.min(1, weather.fog * 1.1 + weather.rain * 0.45);
    this.mesh.position.copy(camera.position);
  }

  /**
   * Re-capture the environment map when the sky changed noticeably
   * (throttled; PMREM generation is not free).
   */
  updateEnvironment(renderer, scene, dt, force = false) {
    this._envTimer -= dt;
    const u = this.uniforms;
    const key = [u.uZenith.value.getHexString(), u.uHorizon.value.getHexString(), u.uSunColor.value.getHexString(),
      Math.round(u.uCloudCover.value * 20), Math.round(u.uFog.value * 20), Math.round(u.uSunDir.value.y * 40)].join();
    if (!force && (this._envTimer > 0 || key === this._lastEnvKey)) return;
    this._envTimer = 0.5;
    this._lastEnvKey = key;

    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(renderer);
    const discs = u.uDiscs.value;
    u.uDiscs.value = 0.15; // keep the sun from blowing out every reflection
    const rt = this._pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    u.uDiscs.value = discs;
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    scene.environment = rt.texture;
  }
}
