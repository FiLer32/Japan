import * as THREE from 'three';
import { GeometryBatcher } from '../utils/GeometryBatcher.js';
import { LANTERNS, terrainHeight, pondSDF } from './layout.js';
import { createRNG } from '../utils/random.js';

/**
 * STONE LANTERNS (tōrō)
 * ---------------------
 * Two classic forms, both built from lathe/cylinder primitives:
 *  - kasuga-dōrō: tall pedestal lantern lining the paths,
 *  - yukimi-dōrō: low, wide-roofed "snow-viewing" lantern on three legs,
 *    used beside the pond.
 * Every lantern holds an emissive fire box, an additive glow sprite and a
 * warm PointLight. All brighten as darkness falls and flicker gently.
 */
export function createLanterns(materials, quality) {
  const M = materials;
  const stone = new GeometryBatcher();
  const fire = new GeometryBatcher();
  const group = new THREE.Group();
  group.name = 'lanterns';
  const rng = createRNG(8);

  const lights = [];
  const glowMat = new THREE.SpriteMaterial({
    map: M.glowTexture, color: 0xffb468, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0,
  });

  let lightBudget = quality.lanternLights;
  LANTERNS.forEach((L, idx) => {
    const yukimi = pondSDF(L.x, L.z) < 9;
    const y0 = terrainHeight(L.x, L.z);
    const s = rng.range(0.92, 1.08);
    const rot = rng.next() * Math.PI;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(L.x, y0, L.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
    const fireY = yukimi ? buildYukimi(stone, fire, M, m) : buildKasuga(stone, fire, M, m);

    const lightPos = new THREE.Vector3(L.x, y0 + fireY * s, L.z);
    const sprite = new THREE.Sprite(glowMat);
    sprite.position.copy(lightPos);
    sprite.scale.setScalar(yukimi ? 1.6 : 1.8);
    group.add(sprite);

    let light = null;
    if (L.light && lightBudget > 0) {
      lightBudget--;
      light = new THREE.PointLight(0xffa24f, 0, 13, 2);
      light.position.copy(lightPos);
      group.add(light);
    }
    lights.push({ light, sprite, phase: idx * 1.7, base: yukimi ? 0.8 : 1 });
  });

  const stoneGroup = stone.build({ name: 'lantern-stone' });
  const fireGroup = fire.build({ name: 'lantern-fire', castShadow: false });
  group.add(stoneGroup, fireGroup);

  const update = (dt, time, day, weather) => {
    // Lanterns are lit at dusk, and a little earlier in gloomy weather.
    const level = Math.min(1, day.lanterns + weather.overcast * 0.25 + weather.fog * 0.2);
    M.lanternFire.emissiveIntensity = 0.2 + level * 5.5;
    glowMat.opacity = level * (0.55 + weather.fog * 0.35);
    for (const L of lights) {
      const flicker = 0.86 + 0.08 * Math.sin(time * 9.1 + L.phase) + 0.06 * Math.sin(time * 17.3 + L.phase * 2.1);
      if (L.light) {
        // Lights stay in the scene (intensity 0 by day): toggling visibility would
        // change the light count and force every material to recompile.
        L.light.intensity = level * 9 * flicker * L.base;
      }
      L.sprite.scale.setScalar((1.5 + weather.fog * 1.2) * (0.95 + flicker * 0.1) * L.base);
    }
  };

  return { group, update, lights: lights.map((l) => l.light).filter(Boolean) };
}

const hex = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);

/** Kasuga-dōrō. Returns the fire box height (local units). */
function buildKasuga(stone, fire, M, m) {
  const parts = [];
  let y = 0;
  const push = (geo, mat, h, yOffset = 0, batch = stone) => {
    const local = new THREE.Matrix4().makeTranslation(0, y + h / 2 + yOffset, 0);
    batch.addMatrix(geo, mat, m.clone().multiply(local));
    geo.dispose();
    parts.push(h);
  };
  push(hex(0.42, 0.46, 0.16), M.stone, 0.16); y += 0.16;         // kiso (base)
  push(hex(0.3, 0.38, 0.12, 12), M.stone, 0.12); y += 0.12;
  push(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 12), M.stone, 0.8); // sao (shaft)
  push(new THREE.TorusGeometry(0.13, 0.03, 6, 12).rotateX(Math.PI / 2), M.stone, 0, 0.4);
  y += 0.8;
  push(hex(0.38, 0.22, 0.18), M.stone, 0.18); y += 0.18;          // chūdai
  // Hibukuro (fire box): glowing core inside six stone posts.
  const fireY = y + 0.2;
  push(hex(0.2, 0.2, 0.36), M.lanternFire, 0.36, 0, fire);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const local = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * 0.235, y + 0.18, Math.sin(a) * 0.235);
    stone.addMatrix(BOX, M.stone, m.clone().multiply(local).multiply(new THREE.Matrix4().makeScale(0.07, 0.36, 0.12)));
  }
  y += 0.36;
  push(hex(0.3, 0.3, 0.05), M.stone, 0.05); y += 0.05;
  // Kasa (roof) with curled corners.
  push(hex(0.12, 0.52, 0.26), M.stone, 0.26); y += 0.26;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const local = new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.5, y - 0.2, Math.sin(a) * 0.5).multiply(new THREE.Matrix4().makeScale(0.06, 0.07, 0.06));
    stone.addMatrix(SPHERE, M.stone, m.clone().multiply(local));
  }
  push(new THREE.CylinderGeometry(0.07, 0.09, 0.07, 10), M.stone, 0.07); y += 0.07;
  push(new THREE.SphereGeometry(0.1, 10, 8), M.stone, 0.14, 0.02); y += 0.14; // hōju
  push(new THREE.ConeGeometry(0.05, 0.1, 10), M.stone, 0.1, 0.03);
  return fireY;
}

/** Yukimi-dōrō (three legs, wide roof). */
function buildYukimi(stone, fire, M, m) {
  const add = (geo, mat, x, y, z, batch = stone, rot = null) => {
    const local = new THREE.Matrix4();
    if (rot) local.makeRotationFromEuler(rot);
    local.setPosition(x, y, z);
    batch.addMatrix(geo, mat, m.clone().multiply(local));
  };
  // Curved legs.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.07, 0.1, 0.62, 8);
    add(leg, M.stone, Math.cos(a) * 0.36, 0.3, Math.sin(a) * 0.36, stone, new THREE.Euler(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35));
    leg.dispose();
  }
  add(hex(0.34, 0.3, 0.1), M.stone, 0, 0.62, 0);
  add(hex(0.22, 0.22, 0.28), M.lanternFire, 0, 0.81, 0, fire);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const local = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * 0.26, 0.81, Math.sin(a) * 0.26);
    stone.addMatrix(BOX, M.stone, m.clone().multiply(local).multiply(new THREE.Matrix4().makeScale(0.07, 0.28, 0.12)));
  }
  add(hex(0.2, 0.78, 0.26), M.stone, 0, 1.08, 0);        // wide umbrella roof
  add(hex(0.78, 0.78, 0.05), M.stone, 0, 0.93, 0);
  add(new THREE.SphereGeometry(0.1, 10, 8), M.stone, 0, 1.28, 0);
  return 0.81;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 8, 6);
