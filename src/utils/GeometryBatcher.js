import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects many small transformed geometries and merges them into one mesh
 * per material. Architecture (pillars, beams, brackets, rafters…) is made of
 * hundreds of boxes and cylinders; batching keeps the draw-call count low.
 */
export class GeometryBatcher {
  constructor() {
    this.buckets = new Map(); // material -> BufferGeometry[]
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /** Add a geometry (cloned) transformed by a Matrix4. */
  addMatrix(geometry, material, matrix) {
    const g = geometry.index ? geometry.clone() : geometry.clone();
    g.applyMatrix4(matrix);
    // Keep attribute layouts compatible for merging.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.index) {
      const idx = [];
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
      g.setIndex(idx);
    }
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
    return this;
  }

  /** Add with position / euler rotation / scale shorthand. */
  add(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    this._p.fromArray(position);
    this._q.setFromEuler(this._e.set(rotation[0], rotation[1], rotation[2]));
    this._s.fromArray(scale);
    this._m.compose(this._p, this._q, this._s);
    return this.addMatrix(geometry, material, this._m);
  }

  /** Box helper: size + centre position (+ optional rotation). */
  box(material, sx, sy, sz, x, y, z, rotation = [0, 0, 0]) {
    return this.add(BOX, material, [x, y, z], rotation, [sx, sy, sz]);
  }

  /** Vertical cylinder helper, positioned by its base. */
  cylinder(material, radiusTop, radiusBottom, height, x, y, z, segments = 12) {
    const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1);
    this.add(g, material, [x, y + height / 2, z]);
    g.dispose();
    return this;
  }

  /** Oriented box spanning from point a to point b (e.g. rafters, beams). */
  beam(material, a, b, width, height, up = UP) {
    const dir = this._p.subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const m = new THREE.Matrix4().lookAt(a, b, up);
    m.scale(new THREE.Vector3(width, height, len));
    m.setPosition(mid);
    return this.addMatrix(BOX, material, m);
  }

  /** Merge everything into a Group of meshes. */
  build({ castShadow = true, receiveShadow = true, name = 'batched' } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
