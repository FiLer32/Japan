/**
 * Entry point.
 *
 * Deliberately tiny and free of static three.js imports: we first verify that
 * WebGL is available (so unsupported browsers get a friendly message instead
 * of a crash), then lazily import the real application. A failed dynamic
 * import (e.g. the CDN is unreachable) is caught and reported too.
 */
import { detectWebGL } from './app/WebGLSupport.js';
import { Overlay } from './ui/Overlay.js';

window.__templeBooted = true;

const overlay = new Overlay();

async function boot() {
  const support = detectWebGL();
  if (!support.ok) {
    overlay.showError(
      'WebGL is not available',
      support.reason,
      'Try enabling hardware acceleration in your browser settings, updating your graphics drivers, or using a recent version of Chrome, Firefox, Edge or Safari.'
    );
    return;
  }

  let App;
  try {
    ({ App } = await import('./app/App.js'));
  } catch (err) {
    console.error(err);
    overlay.showError(
      'Could not load the 3D engine',
      'The three.js modules failed to download or parse.',
      'Check your internet connection (three.js is loaded from cdn.jsdelivr.net) and make sure the page is served over http(s), not opened as a file:// URL.'
    );
    return;
  }

  try {
    const app = new App(document.getElementById('app'), overlay, support);
    await app.init();
    app.start();
    // Handy for debugging from the devtools console.
    window.templeApp = app;
  } catch (err) {
    console.error(err);
    overlay.showError('Failed to build the scene', String(err && err.message ? err.message : err),
      'See the browser console for details.');
  }
}

boot();
