import * as THREE from 'three';
import { MONK_ROUTES, surfaceHeight } from '../world/layout.js';

/**
 * MONKS
 * -----
 * Simple articulated figures (robe, kesa sash, shaved head, arms, legs with
 * sandals) walking closed Catmull-Rom loops through the garden. The walk
 * cycle is procedural: legs swing from the hips, arms counter-swing, the body
 * bobs twice per stride and sways side to side, and the robe hem flares.
 * Height follows layout.surfaceHeight(), so they climb over the bridges.
 * After dark one monk carries a glowing paper lantern.
 */
const ROBE_COLORS = [0x2a2a30, 0x3a3230, 0x23252c];
const KESA_COLORS = [0x9a6a2a, 0x6e4a2c, 0x8a3c26];

export class Monks {
  constructor(materials) {
    this.group = new THREE.Group();
    this.group.name = 'monks';
    this.monks = MONK_ROUTES.map((route, i) => this._createMonk(route, i, materials));
  }

  _createMonk(route, i, M) {
    const curve = new THREE.CatmullRomCurve3(route.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const length = curve.getLength();

    const robeMat = new THREE.MeshStandardMaterial({ color: ROBE_COLORS[i % 3], roughness: 0.9 });
    const kesaMat = new THREE.MeshStandardMaterial({ color: KESA_COLORS[i % 3], roughness: 0.85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc89478, roughness: 0.6 });
    const sandalMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    const sockMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.9 });

    const root = new THREE.Group();
    const body = new THREE.Group();       // bobbing / swaying part
    root.add(body);

    // Legs (pivot at hip, hidden under the robe except the lower shin + foot).
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.86, 0);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.82, 8), sockMat);
      shin.position.y = -0.43;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.25), sandalMat);
      foot.position.set(0, -0.84, 0.05);
      hip.add(shin, foot);
      body.add(hip);
      legs.push(hip);
    }

    // Robe: lathe that flares towards the hem.
    const robePts = [
      [0.001, 1.52], [0.16, 1.5], [0.2, 1.42], [0.21, 1.2], [0.2, 1.0], [0.23, 0.7], [0.28, 0.4], [0.32, 0.12], [0.3, 0.07],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    robePts.reverse();
    const robe = new THREE.Mesh(new THREE.LatheGeometry(robePts, 18), robeMat);
    robe.scale.set(1, 1, 0.8);
    body.add(robe);

    // Kesa: diagonal sash over the left shoulder.
    const kesa = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.24, 0.55, 18, 1, true), kesaMat);
    kesa.position.y = 1.18;
    kesa.rotation.z = 0.35;
    kesa.scale.set(1, 1, 0.8);
    body.add(kesa);

    // Head.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skinMat);
    neck.position.y = 1.56;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skinMat);
    head.scale.set(0.95, 1.08, 1);
    head.position.y = 1.7;
    body.add(neck, head);

    // Arms: sleeve + hand, pivot at shoulder.
    const arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, 1.44, 0);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.55, 10), robeMat);
      sleeve.position.y = -0.27;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skinMat);
      hand.position.y = -0.56;
      shoulder.add(sleeve, hand);
      body.add(shoulder);
      arms.push(shoulder);
    }

    // Paper lantern (chōchin) for the first monk.
    let lantern = null;
    if (i === 0) {
      const lanternMat = new THREE.MeshStandardMaterial({ color: 0xf0e0c0, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.8 });
      lantern = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), sandalMat);
      stick.rotation.x = Math.PI / 2.5;
      stick.position.set(0, 0.05, 0.18);
      const paper = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), lanternMat);
      paper.scale.y = 1.3;
      paper.position.set(0, -0.12, 0.38);
      lantern.add(stick, paper);
      lantern.position.set(0, -0.5, 0);
      arms[1].add(lantern);
      lantern.userData.mat = lanternMat;
    }

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const scale = 0.95 + (i % 3) * 0.04;
    root.scale.setScalar(scale);
    this.group.add(root);

    return {
      root, body, legs, arms, robe, lantern, curve, length,
      speed: route.speed * 0.9,
      dist: (i * 0.37) * length,
      stride: 0,
      pause: 0,
      heading: 0,
    };
  }

  update(dt, time, day) {
    const p = new THREE.Vector3(), ahead = new THREE.Vector3();
    for (const m of this.monks) {
      // Occasional pause (a moment of contemplation).
      if (m.pause > 0) {
        m.pause -= dt;
      } else {
        m.dist = (m.dist + m.speed * dt) % m.length;
        m.stride += m.speed * dt;
        if (Math.random() < dt * 0.012) m.pause = 3 + Math.random() * 4;
      }
      const moving = m.pause <= 0 ? 1 : 0;
      m.moveBlend = THREE.MathUtils.damp(m.moveBlend ?? 1, moving, 4, dt);

      const u = m.dist / m.length;
      m.curve.getPointAt(u, p);
      m.curve.getPointAt((u + 0.6 / m.length) % 1, ahead);
      const y = surfaceHeight(p.x, p.z);
      m.root.position.set(p.x, y, p.z);
      const targetHeading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      let dh = targetHeading - m.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.heading += dh * Math.min(1, dt * 5);
      m.root.rotation.y = m.heading;

      // Lean into slopes (bridges).
      const slope = surfaceHeight(ahead.x, ahead.z) - y;
      m.body.rotation.x = THREE.MathUtils.clamp(slope * 0.25, -0.15, 0.2);

      // Walk cycle: one full cycle per ~1.3 m.
      const phase = (m.stride / 1.3) * Math.PI * 2;
      const k = m.moveBlend;
      const swing = Math.sin(phase) * 0.45 * k;
      m.legs[0].rotation.x = swing;
      m.legs[1].rotation.x = -swing;
      m.arms[0].rotation.x = -swing * 0.5;
      m.arms[1].rotation.x = m.lantern ? -0.5 : swing * 0.5;
      m.arms[0].rotation.z = -0.08;
      m.arms[1].rotation.z = 0.08;
      m.body.position.y = Math.abs(Math.cos(phase)) * 0.035 * k;
      m.body.rotation.z = Math.sin(phase) * 0.03 * k;
      m.robe.rotation.y = Math.sin(phase) * 0.06 * k;
      m.robe.scale.x = 1 + Math.abs(Math.sin(phase)) * 0.06 * k;

      if (m.lantern) {
        m.lantern.userData.mat.emissiveIntensity = day.lanterns * (2.5 + Math.sin(time * 13) * 0.2);
        m.lantern.visible = day.lanterns > 0.05;
        m.lantern.rotation.x = 0.5 + Math.sin(phase * 2) * 0.08;
      }
    }
  }
}
