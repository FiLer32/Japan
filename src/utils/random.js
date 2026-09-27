/**
 * Deterministic pseudo-random numbers so the procedural garden looks the same
 * on every load (mulberry32).
 */
export function createRNG(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
    /** Approximately normal distribution (sum of uniforms). */
    gauss: (mean = 0, sd = 1) => mean + sd * ((next() + next() + next() + next() - 2) * 1.2247),
  };
}
