/**
 * QUALITY PRESETS
 * ---------------
 * Chosen once at start-up from the device type (and overridable with
 * ?quality=low|medium|high in the URL). Counts here drive instancing sizes,
 * shadow-map resolution and render-target scales.
 */
export const PRESETS = {
  high: {
    name: 'high', maxPixelRatio: 2, msaa: 4, shadowMapSize: 4096, terrainSegments: 300,
    grassDensity: 7, petals: 2600, blossomCards: 6, rainDrops: 9000, mistSprites: 36,
    forestTrees: 340, shrubs: 70, lanternLights: 12, koiScale: 1, waterResolution: 0.5,
    splashParticles: 240, birds: 12, fireflies: 180,
  },
  medium: {
    name: 'medium', maxPixelRatio: 1.5, msaa: 2, shadowMapSize: 2048, terrainSegments: 240,
    grassDensity: 4.5, petals: 1800, blossomCards: 5, rainDrops: 6500, mistSprites: 28,
    forestTrees: 260, shrubs: 55, lanternLights: 10, koiScale: 0.85, waterResolution: 0.45,
    splashParticles: 180, birds: 10, fireflies: 140,
  },
  low: {
    name: 'low', maxPixelRatio: 1.25, msaa: 0, shadowMapSize: 1024, terrainSegments: 180,
    grassDensity: 2.2, petals: 900, blossomCards: 4, rainDrops: 3500, mistSprites: 18,
    forestTrees: 180, shrubs: 40, lanternLights: 6, koiScale: 0.7, waterResolution: 0.35,
    splashParticles: 120, birds: 8, fireflies: 90,
  },
};

const STORAGE_KEY = 'sakura-temple.quality';

/** Remember a manual choice (used by the control panel). */
export function saveQuality(name) {
  try { localStorage.setItem(STORAGE_KEY, name); } catch { /* storage unavailable */ }
}

/**
 * Priority: #low/#medium/#high in the URL, ?quality=, the choice saved from
 * the control panel, then device detection (desktops get "high").
 */
export function pickQuality(support) {
  const hash = location.hash.replace('#', '');
  if (PRESETS[hash]) return { ...PRESETS[hash], source: 'manual' };
  const param = new URLSearchParams(location.search).get('quality');
  if (param && PRESETS[param]) return { ...PRESETS[param], source: 'manual' };
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  if (saved && PRESETS[saved]) return { ...PRESETS[saved], source: 'manual' };
  if (support.isMobile) return { ...PRESETS.low, source: 'auto' };
  const cores = navigator.hardwareConcurrency || 8;
  return { ...(cores >= 4 ? PRESETS.high : PRESETS.medium), source: 'auto' };
}
