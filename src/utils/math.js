/** Small scalar helpers mirroring their GLSL counterparts. */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => clamp(v, 0, 1);
export function smoothstep(e0, e1, x) {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach (critically damped feel). */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

/** Distance from point p to segment ab in 2D (x/z plane). */
export function distToSegment2(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = saturate(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1));
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}
