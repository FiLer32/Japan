import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * RENDERER + POST-PROCESSING
 * --------------------------
 * - Physically based pipeline: linear lighting, ACES filmic tone mapping,
 *   sRGB output.
 * - Soft shadows (PCFSoftShadowMap) from the single sun/moon light.
 * - Bloom so lantern flames and glowing shōji bleed light into the mist.
 */
export class Renderer {
  constructor(container, quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,               // MSAA happens in the composer target instead
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.bloomEnabled = true;
  }

  /** Composer needs the scene & camera, so it is created after them. */
  setupComposer(scene, camera) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  setShadows(enabled, scene) {
    this.renderer.shadowMap.enabled = enabled;
    // Materials must recompile when the shadow define changes.
    this.renderer.shadowMap.needsUpdate = true;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }

  resize(camera) {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }

  get domElement() { return this.renderer.domElement; }
}
