import * as THREE from 'three';
import * as T from './textures.js';

/**
 * MATERIAL LIBRARY
 * ----------------
 * Shared PBR materials (MeshStandardMaterial) used across the scene. Sharing
 * instances keeps shader programs and texture uploads to a minimum.
 *
 * Materials exposed to the weather are registered as "wettable": while it
 * rains their roughness drops and albedo darkens, giving wet, glossy stone
 * and wood that pick up reflections of the lanterns.
 */
export class MaterialLibrary {
  constructor(renderer) {
    T.setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    this._wettable = [];
    this._build();
  }

  _std(params, { wet = 0 } = {}) {
    const m = new THREE.MeshStandardMaterial(params);
    if (wet > 0) {
      this._wettable.push({ m, rough: m.roughness, color: m.color.clone(), wet });
    }
    return m;
  }

  _build() {
    // --- Wood -------------------------------------------------------------
    const woodDark = T.woodTexture([112, 76, 50], [48, 30, 20]);
    const woodVerm = T.woodTexture([196, 64, 38], [138, 36, 22], { knots: false });
    const woodNatural = T.woodTexture([178, 140, 98], [112, 80, 52]);
    const woodFloor = T.woodTexture([150, 112, 76], [84, 58, 38], { grain: 1.5 });

    this.woodDark = this._std({ map: woodDark.map, normalMap: woodDark.normalMap, roughness: 0.78, normalScale: new THREE.Vector2(0.6, 0.6) }, { wet: 0.6 });
    this.woodVermilion = this._std({ map: woodVerm.map, normalMap: woodVerm.normalMap, roughness: 0.55, normalScale: new THREE.Vector2(0.3, 0.3) }, { wet: 0.5 });
    this.woodNatural = this._std({ map: woodNatural.map, normalMap: woodNatural.normalMap, roughness: 0.8 }, { wet: 0.7 });
    this.woodFloor = this._std({ map: woodFloor.map, normalMap: woodFloor.normalMap, roughness: 0.6 }, { wet: 0.7 });
    this.lacquerBlack = this._std({ color: 0x1b1716, roughness: 0.42 }, { wet: 0.4 });
    this.soffit = this._std({ map: woodDark.map, color: 0xb0a090, roughness: 0.9 });

    // --- Roof -------------------------------------------------------------
    const tiles = T.roofTileTexture();
    this.roofTile = this._std({
      map: tiles.map, normalMap: tiles.normalMap, roughness: 0.5, metalness: 0.15,
      normalScale: new THREE.Vector2(1.2, 1.2),
    }, { wet: 0.8 });
    this.roofRidge = this._std({ color: 0x2d3036, roughness: 0.45, metalness: 0.2 }, { wet: 0.8 });

    // --- Walls ------------------------------------------------------------
    const plaster = T.plasterTexture();
    this.plaster = this._std({ map: plaster.map, normalMap: plaster.normalMap, roughness: 0.92 });

    const shoji = T.shojiTextures();
    this.shoji = new THREE.MeshStandardMaterial({
      map: shoji.map, emissiveMap: shoji.emissiveMap, emissive: new THREE.Color(0xffa04a),
      emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide,
    });

    // --- Stone & ground ------------------------------------------------------
    const stone = T.stoneTexture();
    this.stone = this._std({ map: stone.map, normalMap: stone.normalMap, roughness: 0.88 }, { wet: 0.9 });
    const stoneLight = T.stoneTexture(256, [176, 172, 164]);
    this.stoneLight = this._std({ map: stoneLight.map, normalMap: stoneLight.normalMap, roughness: 0.85 }, { wet: 0.9 });
    this.rock = this._std({ map: stone.map, normalMap: stone.normalMap, color: 0x9a978f, roughness: 0.9 }, { wet: 1 });

    const gravel = T.gravelTexture(512, false);
    this.gravel = this._std({ map: gravel.map, normalMap: gravel.normalMap, roughness: 0.95, normalScale: new THREE.Vector2(1.3, 1.3) }, { wet: 1 });
    const raked = T.gravelTexture(512, true);
    this.gravelRaked = this._std({ map: raked.map, normalMap: raked.normalMap, roughness: 0.95, normalScale: new THREE.Vector2(1.5, 1.5) }, { wet: 1 });

    const ground = T.groundDetailTexture();
    ground.map.repeat.set(60, 60);
    ground.normalMap.repeat.set(60, 60);
    this.ground = this._std({ map: ground.map, normalMap: ground.normalMap, vertexColors: true, roughness: 0.96 }, { wet: 0.6 });

    // --- Trees ------------------------------------------------------------
    const bark = T.barkTexture();
    this.bark = this._std({ map: bark.map, normalMap: bark.normalMap, roughness: 0.92 }, { wet: 0.8 });
    this.blossomTexture = T.blossomCardTexture();

    // --- Metals & light ------------------------------------------------------
    this.gold = new THREE.MeshStandardMaterial({ color: 0xd8a84e, metalness: 1, roughness: 0.28 });
    this.bronze = new THREE.MeshStandardMaterial({ color: 0x6b5a3c, metalness: 0.85, roughness: 0.45 });
    this.lanternFire = new THREE.MeshStandardMaterial({
      color: 0x221810, emissive: new THREE.Color(0xffa656), emissiveIntensity: 0, roughness: 1,
    });

    this.glowTexture = T.glowTexture();
    this.mistTexture = T.mistTexture();
    this.koiTextures = T.koiTextures();
  }

  /** 0 = dry, 1 = soaked. Called by the weather system every frame. */
  setWetness(w) {
    if (Math.abs(w - (this._lastWet ?? -1)) < 0.002) return;
    this._lastWet = w;
    for (const e of this._wettable) {
      const k = w * e.wet;
      e.m.roughness = e.rough * (1 - 0.65 * k);
      e.m.color.copy(e.color).multiplyScalar(1 - 0.28 * k);
    }
  }
}
