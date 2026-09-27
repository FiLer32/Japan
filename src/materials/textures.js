import * as THREE from 'three';
import { SimplexNoise } from '../utils/noise.js';
import { createRNG } from '../utils/random.js';

/**
 * PROCEDURAL TEXTURES
 * -------------------
 * Every surface texture in the scene is painted at start-up onto a canvas.
 * This keeps the project asset-free and lets us derive matching normal maps
 * from the same height fields.
 */

const nz = new SimplexNoise(42);
let maxAnisotropy = 8;
export function setMaxAnisotropy(v) { maxAnisotropy = v; }

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  t.needsUpdate = true;
  return t;
}

/** Tileable fBm by blending four offset samples (period = 1 in u and v). */
function seamless(fn, u, v) {
  const a = fn(u, v), b = fn(u - 1, v), c = fn(u, v - 1), d = fn(u - 1, v - 1);
  const k = (1 - u) * (1 - v), l = u * (1 - v), m = (1 - u) * v, n = u * v;
  // Re-normalise the contrast loss from blending.
  return (a * k + b * l + c * m + d * n) / Math.sqrt(k * k + l * l + m * m + n * n);
}

/**
 * Paint a texture per pixel. `fn(u, v, x, y)` returns [r, g, b] (0-255) and
 * optionally a height (0-1) at index 3 which is used to build a normal map.
 */
function paint(size, fn, { height = false, strength = 2, sizeY = size } = {}) {
  const canvas = makeCanvas(size, sizeY);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, sizeY);
  const heights = height ? new Float32Array(size * sizeY) : null;
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < size; x++) {
      const out = fn(x / size, y / sizeY, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = out[0];
      img.data[i + 1] = out[1];
      img.data[i + 2] = out[2];
      img.data[i + 3] = out.length > 4 ? out[4] : 255;
      if (heights) heights[y * size + x] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  const result = { map: toTexture(canvas) };
  if (heights) result.normalMap = heightToNormal(heights, size, sizeY, strength);
  return result;
}

/** Sobel-filter a height field into a tangent-space normal map. */
function heightToNormal(h, w, hh, strength) {
  const canvas = makeCanvas(w, hh);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, hh);
  const at = (x, y) => h[((y + hh) % hh) * w + ((x + w) % w)];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nzv = 1;
      const len = Math.hypot(nx, ny, nzv);
      nx /= len; ny /= len; nzv /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nzv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { srgb: false });
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* ------------------------------------------------------------------ */

/** Wood with grain running along V. */
export function woodTexture(light, dark, { size = 256, grain = 1, knots = true } = {}) {
  return paint(size, (u, v) => {
    const g = seamless((a, b) => nz.fbm2(a * 3 + 11, b * 0.45 * grain, 4), u, v);
    const lines = Math.abs(Math.sin((u * 26 + g * 3.5) * Math.PI));
    const fine = seamless((a, b) => nz.noise2(a * 60, b * 4), u, v) * 0.5 + 0.5;
    let t = 0.55 * Math.pow(lines, 0.6) + 0.25 * fine + 0.2 * (g * 0.5 + 0.5);
    if (knots) {
      const k = seamless((a, b) => nz.noise2(a * 5 + 40, b * 2), u, v);
      if (k > 0.72) t *= 0.75;
    }
    const c = mix3(dark, light, Math.min(1, Math.max(0, t)));
    return [c[0], c[1], c[2], t];
  }, { height: true, strength: 1.2 });
}

/** Japanese kawara roof tiles (round cover tiles over concave pan tiles). */
export function roofTileTexture(size = 256) {
  const cols = 8, rows = 8;
  return paint(size, (u, v) => {
    const cu = (u * cols) % 1;                   // position within a tile column
    const rv = (v * rows) % 1;                   // position within a course
    const col = Math.floor(u * cols), row = Math.floor(v * rows);
    // Cross profile: convex cover tile centred at cu = 0 / 1, concave pan between.
    const dCover = Math.min(cu, 1 - cu) / 0.2;  // 0 at cover centre
    let h;
    let ao = 1;
    if (dCover < 1) {
      h = 0.55 + 0.45 * Math.sqrt(1 - dCover * dCover);
      ao = 0.85 + 0.15 * (1 - dCover);
    } else {
      const p = (cu - 0.2) / 0.6;                // 0..1 across the pan
      h = 0.35 - 0.2 * Math.sin(p * Math.PI);
      ao = 0.7 + 0.3 * Math.sin(p * Math.PI) * 0.5;
      if (dCover < 1.25) ao *= 0.55;             // shadow gap beside cover tile
    }
    // Courses overlap: each row rises then steps down at its lower lip.
    h += rv * 0.18;
    if (rv > 0.93) { h -= 0.2; ao *= 0.6; }
    const tileVar = hash2(col * 3.1, row * 7.7) * 0.18 - 0.09;
    const grime = nz.noise2(u * 9, v * 9) * 0.06;
    const base = 58 + tileVar * 255 * 0.4 + grime * 255;
    const c = [base * 0.92 * ao, base * 0.97 * ao, base * 1.06 * ao];
    return [c[0], c[1], c[2], h];
  }, { height: true, strength: 5 });
}

/** Lime plaster wall. */
export function plasterTexture(size = 256) {
  return paint(size, (u, v) => {
    const n = seamless((a, b) => nz.fbm2(a * 6, b * 6, 4), u, v);
    const stain = Math.max(0, seamless((a, b) => nz.fbm2(a * 2 + 5, b * 3, 3), u, v)) * (0.6 + v * 0.6);
    const t = 236 + n * 8 - stain * 30;
    return [t, t - 5 - stain * 6, t - 14 - stain * 10, 0.5 + n * 0.5];
  }, { height: true, strength: 0.6 });
}

/** Weathered granite for lanterns, podiums and steps. */
export function stoneTexture(size = 256, tint = [150, 148, 142]) {
  return paint(size, (u, v, x, y) => {
    const m = seamless((a, b) => nz.fbm2(a * 5, b * 5, 5), u, v);
    const speck = hash2(x, y);
    let t = 0.75 + m * 0.2;
    if (speck > 0.93) t -= 0.25;
    else if (speck < 0.05) t += 0.18;
    const moss = Math.max(0, seamless((a, b) => nz.fbm2(a * 3 + 9, b * 3 + 2, 3), u, v) - 0.25) * 1.5;
    const c = mix3([tint[0] * t, tint[1] * t, tint[2] * t], [78, 96, 52], Math.min(0.7, moss));
    return [c[0], c[1], c[2], 0.5 + m * 0.4 + (speck > 0.93 ? -0.05 : 0)];
  }, { height: true, strength: 1.6 });
}

/** Pebble gravel, optionally with raked furrows (karesansui). */
export function gravelTexture(size = 512, raked = false) {
  const rng = createRNG(raked ? 77 : 33);
  const heights = new Float32Array(size * size).fill(0.2);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = raked ? '#8f8a80' : '#7b756b';
  ctx.fillRect(0, 0, size, size);
  const stones = raked ? 9000 : 6000;
  for (let i = 0; i < stones; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    const r = rng.range(1.6, raked ? 3.4 : 4.6);
    const shade = rng.range(raked ? 150 : 110, raked ? 225 : 195);
    const warm = rng.range(-10, 12);
    ctx.fillStyle = `rgb(${shade + warm},${shade + warm * 0.4},${shade - warm * 0.3})`;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r, r * rng.range(0.6, 1), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rough height splat for the normal map.
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const px = ((Math.floor(x) + dx) % size + size) % size;
        const py = ((Math.floor(y) + dy) % size + size) % size;
        const hv = 0.3 + 0.7 * Math.sqrt(1 - d * d);
        if (hv > heights[py * size + px]) heights[py * size + px] = hv;
      }
    }
  }
  if (raked) {
    // Parallel furrows modulate brightness and height.
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const f = Math.sin((y / size) * Math.PI * 2 * 16);
      const shade = 0.82 + 0.18 * f;
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        img.data[i] *= shade; img.data[i + 1] *= shade; img.data[i + 2] *= shade;
        heights[y * size + x] = heights[y * size + x] * 0.35 + (f * 0.5 + 0.5) * 0.65;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return { map: toTexture(canvas), normalMap: heightToNormal(heights, size, size, raked ? 3 : 4) };
}

/** Neutral detail texture multiplied with the terrain's vertex colours. */
export function groundDetailTexture(size = 256) {
  return paint(size, (u, v, x, y) => {
    const n = seamless((a, b) => nz.fbm2(a * 8, b * 8, 4), u, v);
    const blades = hash2(x * 1.3, y * 0.7);
    let t = 0.86 + n * 0.1 + (blades - 0.5) * 0.16;
    return [255 * t, 255 * Math.min(1, t * 1.02), 255 * t * 0.95, 0.5 + n * 0.3 + blades * 0.2];
  }, { height: true, strength: 1.4 });
}

/** Cherry bark: dark grey-brown with horizontal lenticel stripes. */
export function barkTexture(size = 256) {
  return paint(size, (u, v, x, y) => {
    const n = seamless((a, b) => nz.fbm2(a * 4, b * 10, 4), u, v);
    const lent = Math.sin((v * 40 + nz.noise2(u * 6, v * 3) * 2) * Math.PI);
    const stripe = lent > 0.86 && hash2(Math.floor(u * 18), Math.floor(v * 40)) > 0.35 ? 1 : 0;
    const t = 0.55 + n * 0.25;
    const c = mix3([62 * t, 48 * t, 44 * t], [150, 130, 118], stripe * 0.55);
    return [c[0], c[1], c[2], 0.5 + n * 0.4 - stripe * 0.15];
  }, { height: true, strength: 2.2 });
}

/**
 * Shōji sliding door: rice paper in a wooden kumiko lattice with a solid
 * kick-panel. Returns albedo plus an emissive mask (paper only glows).
 */
export function shojiTextures(w = 256, h = 512) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const mask = makeCanvas(w, h);
  const mctx = mask.getContext('2d');
  // Paper with faint fibres.
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, w, h);
  const rng = createRNG(5);
  ctx.strokeStyle = 'rgba(180,160,130,0.10)';
  for (let i = 0; i < 400; i++) {
    ctx.beginPath();
    const x = rng.next() * w, y = rng.next() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-12, 12), y + rng.range(-12, 12));
    ctx.stroke();
  }
  mctx.fillStyle = '#fff';
  mctx.fillRect(0, 0, w, h);
  const wood = '#5a3a22';
  const frame = 14, bar = 5;
  const kick = h * 0.22;
  const draw = (x, y, ww, hh) => {
    ctx.fillStyle = wood; ctx.fillRect(x, y, ww, hh);
    mctx.fillStyle = '#000'; mctx.fillRect(x, y, ww, hh);
  };
  draw(0, 0, w, frame); draw(0, h - frame, w, frame);
  draw(0, 0, frame, h); draw(w - frame, 0, frame, h);
  draw(0, h - kick, w, kick); // koshi-ita kick panel
  // Wood grain on kick panel.
  ctx.strokeStyle = 'rgba(30,18,10,0.35)';
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    const y = h - kick + (i / 18) * kick;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1);
    ctx.stroke();
  }
  const cols = 3, rowsN = 6;
  for (let i = 1; i < cols; i++) draw((w / cols) * i - bar / 2, 0, bar, h - kick);
  for (let j = 1; j < rowsN; j++) draw(0, ((h - kick) / rowsN) * j - bar / 2, w, bar);
  const map = toTexture(canvas, { repeat: false });
  const emissiveMap = toTexture(mask, { repeat: false });
  return { map, emissiveMap };
}

/** Clusters of five-petal cherry blossoms on transparent background. */
export function blossomCardTexture(size = 256) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rng = createRNG(11);
  const flower = (x, y, r, hue, light) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.next() * Math.PI);
    for (let p = 0; p < 5; p++) {
      ctx.rotate((Math.PI * 2) / 5);
      const grad = ctx.createRadialGradient(0, -r * 0.5, 0, 0, -r * 0.5, r * 0.75);
      grad.addColorStop(0, `hsl(${hue}, 70%, ${light + 8}%)`);
      grad.addColorStop(1, `hsl(${hue}, 60%, ${light - 6}%)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(r * 0.55, -r * 0.3, r * 0.45, -r * 0.95, r * 0.12, -r);
      ctx.lineTo(0, -r * 0.86);                 // the characteristic notch
      ctx.lineTo(-r * 0.12, -r);
      ctx.bezierCurveTo(-r * 0.45, -r * 0.95, -r * 0.55, -r * 0.3, 0, 0);
      ctx.fill();
    }
    ctx.fillStyle = `hsl(${hue - 10}, 70%, 45%)`;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // Soft backing so clusters read as a volume, not isolated flowers.
  for (let i = 0; i < 14; i++) {
    const x = size * 0.5 + rng.gauss(0, size * 0.16), y = size * 0.5 + rng.gauss(0, size * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 0.13);
    g.addColorStop(0, 'rgba(236,170,190,0.8)');
    g.addColorStop(1, 'rgba(236,170,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < 55; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * size * 0.38;
    flower(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, rng.range(size * 0.05, size * 0.085),
      rng.range(335, 355), rng.range(80, 92));
  }
  return dilatedTexture(canvas, [236, 176, 196]);
}

/**
 * Canvas pixels with zero alpha are stored as black, which bleeds dark
 * fringes into mipmaps of alpha-tested foliage. Re-colour fully transparent
 * texels with a matching fill before uploading as a DataTexture.
 */
function dilatedTexture(canvas, fill) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    // Un-premultiplied colour is unreliable at low alpha; blend towards the fill.
    const k = Math.min(1, a * 2.5);
    d[i] = d[i] * k + fill[0] * (1 - k);
    d[i + 1] = d[i + 1] * k + fill[1] * (1 - k);
    d[i + 2] = d[i + 2] * k + fill[2] * (1 - k);
  }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), canvas.width, canvas.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = maxAnisotropy;
  t.needsUpdate = true;
  return t;
}

/** Radial glow sprite (lantern halos, fireflies). */
export function glowTexture(size = 128) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { repeat: false });
}

/** Soft cloudy blob for mist sprites. */
export function mistTexture(size = 128) {
  const n = new SimplexNoise(9);
  return paint(size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const f = n.fbm2(u * 4, v * 4, 4) * 0.5 + 0.5;
    const a = Math.max(0, 1 - d) ** 1.5 * (0.45 + 0.55 * f);
    return [255, 255, 255, 0, a * 255];
  }).map;
}

/**
 * Koi skin patterns. UV: u runs head (0) -> tail (1), v wraps around the body.
 * Returns an array of textures (kohaku, sanke, showa, ogon, tancho, asagi).
 */
export function koiTextures() {
  const variants = [];
  const N = new SimplexNoise(123);
  const make = (seed, fn) => {
    const off = seed * 17.3;
    return paint(128, (u, v) => fn(u, v, (a, b, f = 5) => N.fbm2(a * f + off, b * f * 0.6 + off, 3)), { sizeY: 64 }).map;
  };
  const white = [245, 242, 235], red = [214, 58, 22], black = [22, 20, 22], gold = [236, 170, 58];
  const belly = (v) => Math.abs(v - 0.5) > 0.36; // underside stays pale
  variants.push(make(1, (u, v, f) => (f(u, v) > 0.05 && !belly(v) && u < 0.88 ? red : white)));
  variants.push(make(2, (u, v, f) => {
    if (belly(v)) return white;
    if (f(u, v, 9) > 0.45) return black;
    return f(u, v) > 0.08 ? red : white;
  }));
  variants.push(make(3, (u, v, f) => {
    if (f(u, v, 6) > -0.05 && !belly(v)) return black;
    return f(u + 3, v, 5) > 0.15 ? red : white;
  }));
  variants.push(make(4, (u, v, f) => mix3(gold, [255, 220, 130], f(u, v, 12) * 0.5 + 0.5)));
  variants.push(make(5, (u, v) => (Math.hypot((u - 0.14) * 2.2, v - 0.5) < 0.16 ? red : white)));
  variants.push(make(6, (u, v, f) => (belly(v) ? [228, 110, 60] : mix3([80, 110, 140], [150, 175, 195], f(u * 3, v * 3, 20) * 0.5 + 0.5))));
  return variants;
}
