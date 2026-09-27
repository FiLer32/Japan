import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { surfaceHeight } from '../world/layout.js';

/**
 * CAMERA + ORBIT CONTROLS
 * -----------------------
 * Free orbit / zoom / pan with damping. The rig keeps the camera above the
 * ground and the orbit target inside the garden so users cannot get lost.
 */
const HOME_POSITION = new THREE.Vector3(44, 21, 50);
const HOME_TARGET = new THREE.Vector3(6, 2.5, -1);

export class CameraRig {
  constructor(domElement) {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.copy(HOME_POSITION);

    const c = new OrbitControls(this.camera, domElement);
    c.target.copy(HOME_TARGET);
    c.enableDamping = true;
    c.dampingFactor = 0.06;
    c.minDistance = 2.5;
    c.maxDistance = 170;
    c.maxPolarAngle = Math.PI * 0.495;
    c.screenSpacePanning = false;   // pan along the ground plane
    c.zoomToCursor = true;
    c.rotateSpeed = 0.6;
    c.panSpeed = 0.8;
    c.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
    c.listenToKeyEvents(window);
    c.update();
    this.controls = c;

    // Smooth "fly home" animation state.
    this._flyT = 1;
    this._fromPos = new THREE.Vector3();
    this._fromTarget = new THREE.Vector3();
  }

  reset() {
    this._flyT = 0;
    this._fromPos.copy(this.camera.position);
    this._fromTarget.copy(this.controls.target);
  }

  update(dt) {
    const c = this.controls;
    if (this._flyT < 1) {
      this._flyT = Math.min(1, this._flyT + dt / 1.6);
      const k = 1 - Math.pow(1 - this._flyT, 3);
      this.camera.position.lerpVectors(this._fromPos, HOME_POSITION, k);
      c.target.lerpVectors(this._fromTarget, HOME_TARGET, k);
    }

    // Keep the orbit target within the garden.
    c.target.x = THREE.MathUtils.clamp(c.target.x, -60, 70);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -60, 60);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 25);
    c.update();

    // Never dip below the terrain.
    const p = this.camera.position;
    const floor = surfaceHeight(p.x, p.z) + 0.6;
    if (p.y < floor) p.y = floor;
  }
}
