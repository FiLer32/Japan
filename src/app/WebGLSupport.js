/**
 * WebGL capability detection. Runs before three.js is even downloaded.
 * Returns { ok, webgl2, reason, isMobile, maxTextureSize }.
 */
export function detectWebGL() {
  const result = { ok: false, webgl2: false, reason: '', isMobile: false, maxTextureSize: 0 };

  result.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

  try {
    const canvas = document.createElement('canvas');
    // three.js r163+ requires WebGL 2.
    const gl = canvas.getContext('webgl2');
    if (gl) {
      result.ok = true;
      result.webgl2 = true;
      result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return result;
    }
    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    result.reason = gl1
      ? 'Your browser supports WebGL 1 only, but this scene requires WebGL 2.'
      : 'Your browser or device does not support WebGL, or it has been disabled.';
  } catch (e) {
    result.reason = 'WebGL initialisation threw an error: ' + e.message;
  }
  return result;
}
