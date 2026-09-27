import * as THREE from 'three';

/**
 * BIRDS
 * -----
 * A small flock circling above the garden: each bird follows a slowly
 * drifting orbit with its own radius/height/phase, flapping in bursts and
 * gliding in between. As night falls the flock heads off to roost beyond the
 * hills and hides; it returns in the morning.
 */
const ROOST = new THREE.Vector3(-160, 45, -170);

export class Birds {
  constructor(count = 12) {
    this.group = new THREE.Group();
    this.group.name = 'birds';
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.8, side: THREE.DoubleSide });

    const bodyGeo = new THREE.ConeGeometry(0.09, 0.5, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.1);
    wingShape.lineTo(0.55, 0.02);
    wingShape.lineTo(0.62, -0.08);
    wingShape.lineTo(0, -0.12);
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    wingGeo.rotateX(-Math.PI / 2);

    this.birds = [];
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat);
      const wl = new THREE.Mesh(wingGeo, mat);
      const wr = new THREE.Mesh(wingGeo, mat);
      wr.scale.x = -1;
      g.add(body, wl, wr);
      g.scale.setScalar(0.9 + Math.random() * 0.4);
      this.group.add(g);
      this.birds.push({
        mesh: g, wl, wr,
        radius: 18 + Math.random() * 22,
        height: 16 + Math.random() * 12,
        speed: (0.18 + Math.random() * 0.08) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        flap: Math.random() * 10,
        home: 1,              // 1 = over the garden, 0 = roosting
        prev: new THREE.Vector3(),
      });
    }
    this._orbit = new THREE.Vector3();
  }

  update(dt, time, day, weather) {
    // Fewer birds in rain/fog; none at night.
    const wantOut = day.daylight > 0.25 && weather.rain < 0.6;
    const cx = 8 + Math.sin(time * 0.03) * 10, cz = Math.cos(time * 0.025) * 8;
    for (const b of this.birds) {
      b.home = THREE.MathUtils.damp(b.home, wantOut ? 1 : 0, 0.25, dt);
      const a = b.phase + time * b.speed;
      this._orbit.set(cx + Math.cos(a) * b.radius, b.height + Math.sin(time * 0.4 + b.phase) * 2, cz + Math.sin(a) * b.radius);
      const pos = b.mesh.position;
      b.prev.copy(pos);
      pos.lerpVectors(ROOST, this._orbit, b.home);
      b.mesh.visible = b.home > 0.03;

      // Face the direction of travel.
      const vx = pos.x - b.prev.x, vy = pos.y - b.prev.y, vz = pos.z - b.prev.z;
      if (vx * vx + vz * vz > 1e-8) {
        b.mesh.rotation.set(-Math.atan2(vy, Math.hypot(vx, vz)) * 0.5, Math.atan2(vx, vz), -b.speed * 1.5, 'YXZ');
      }
      // Flap in bursts, glide in between.
      const burst = Math.sin(time * 0.6 + b.phase * 3) > -0.2 || b.home < 0.95;
      b.flap += dt * (burst ? 14 : 2);
      const ang = burst ? Math.sin(b.flap) * 0.7 : 0.12 + Math.sin(b.flap) * 0.05;
      b.wl.rotation.z = ang;
      b.wr.rotation.z = -ang;
    }
  }
}
