/**
 * "Quiet Fathoms" palette. Every color in the scene comes from here.
 * Mode changes always blend in OKLab (mixOK), never in raw sRGB, so coral-to-indigo
 * passes through plum instead of mud.
 */
import type { LightingMode } from '../types/sanctuary';

// ---------------------------------------------------------------------------
// Constant tokens (identical in every mode)
// ---------------------------------------------------------------------------

export const C = {
  /** Cyan. Only for living things at night. Never UI chrome. */
  biolum: '#5FF3E6',
  biolumCore: '#B4FFF6',
  coral: '#F2899A',
  coralDeep: '#C65F78',
  coralPolyp: '#FF8FA8',
  gold: '#F2C14E',
  goldDeep: '#B07A1E',
  goldRing: '#B9832C',
  lantern: '#FFC86B',
  lilac: '#B9A7FF',
  lilacLight: '#E3DCFF',
  lilacRing: '#8E7FD6',
  moonBell: '#9FF3F0',
  sunsetBell: '#F2B65A',
  wart: '#FFE2A8',
  seahorseGold: '#F0B44C',
  pearl1: '#FFF8E7',
  pearl2: '#F3D08A',
  pearl3: '#C9963F',
  whalePearl1: '#FFF8E7',
  whalePearl2: '#F7C6CF',
  whalePearl3: '#9FE9EC',
  paperInk: '#1D2458',
  paperStain: '#C9A97A',
  cork: '#C99A6B',
  glass: '#96E6DC',
  hazeMidnight: '#33408F',
  /** Night bodies are mixed 40% toward this. Also the darkest allowed scene color. */
  nightFloor: '#0B0F34',
} as const;

export const paperFor: Record<LightingMode, string> = {
  day: '#EEF6F1',
  sunset: '#F8E3D6',
  midnight: '#D5DBF2',
};

// ---------------------------------------------------------------------------
// Per-mode tokens
// ---------------------------------------------------------------------------

/** Water column gradient stops, [offset 0..1 from the top, color]. */
export const waterStops: Record<LightingMode, [number, string][]> = {
  day: [
    [0, '#C8F0E6'],
    [0.16, '#86D4D4'],
    [0.48, '#3E8FB6'],
    [0.78, '#28609A'],
    [1, '#23377C'],
  ],
  sunset: [
    [0, '#FFD7A1'],
    [0.14, '#F6A58E'],
    [0.38, '#C7718F'],
    [0.66, '#653D7C'],
    [1, '#22184E'],
  ],
  midnight: [
    [0, '#384592'],
    [0.3, '#29317A'],
    [0.6, '#1E2566'],
    [1, '#121644'],
  ],
};

/** Color tokens that change with the time of day. */
export type ModeColor =
  | 'window' // Snell's window glow at the surface
  | 'disc' // sun (sunset) or moon (midnight) disc; unused by day
  | 'l1' // far ridge
  | 'whaleLane'
  | 'l2' // ruins shelf
  | 'l3' // kelp wall
  | 'l4' // reef rock
  | 'seagrass'
  | 'l5' // seabed
  | 'l6' // near occluders
  | 'ridgeCap' // sediment caps along layer tops
  | 'ray' // light shafts
  | 'caustic'
  | 'snow' // marine snow
  | 'bokeh' // near out-of-focus specks
  | 'rim' // creature top rim light at sunset (night rims use the creature's own hue)
  | 'kelpBlade'
  | 'kelpEdge'
  | 'seaFanBranch'
  | 'seaFanPolyp'
  | 'chestBody'
  | 'chestBand'
  | 'inkTop' // UI ink in the top 45% of the screen
  | 'inkDeep' // UI ink in the lower part of the screen, shop, captions
  | 'paper';

/** Number tokens that change with the time of day. */
export type ModeNumber =
  | 'windowAlpha'
  | 'discAlpha'
  | 'rayAlpha'
  | 'rayCount'
  | 'rayTiltDeg'
  | 'causticWindowAlpha'
  | 'causticSeabedAlpha'
  | 'snowAlpha'
  | 'bokehAlpha'
  | 'rimAlpha'
  | 'ridgeCapAlpha' // multiplier; final alpha = ridgeCapAlpha * (1 - fog)
  | 'bodyDarken' // 0..0.4, how far creature bodies mix toward C.nightFloor
  | 'glowGain' // multiplies every glow sprite
  | 'vignette'; // corner darkness 0..1

export interface ModeTokens {
  color: Record<ModeColor, string>;
  num: Record<ModeNumber, number>;
}

export const modeTokens: Record<LightingMode, ModeTokens> = {
  day: {
    color: {
      window: '#F4FFF8',
      disc: '#F4FFF8',
      l1: '#357CA5',
      whaleLane: '#36779D',
      l2: '#28608E',
      l3: '#1F4E72',
      l4: '#153967',
      seagrass: '#1D6066',
      l5: '#102D5A',
      l6: '#0C2448',
      ridgeCap: '#DFF7EE',
      ray: '#E9FFF6',
      caustic: '#FFFFFF',
      snow: '#F4FFF8',
      bokeh: '#E9FFF6',
      rim: '#FFFFFF',
      kelpBlade: '#8A7440',
      kelpEdge: '#C2A660',
      seaFanBranch: '#E9798E',
      seaFanPolyp: '#E9798E',
      chestBody: '#5A3A2E',
      chestBand: '#E2B04A',
      inkTop: '#0F2346',
      inkDeep: '#E9F7F3',
      paper: paperFor.day,
    },
    num: {
      windowAlpha: 0.6,
      discAlpha: 0,
      rayAlpha: 0.13,
      rayCount: 5,
      rayTiltDeg: 0,
      causticWindowAlpha: 0.06,
      causticSeabedAlpha: 0.08,
      snowAlpha: 0.3,
      bokehAlpha: 0.1,
      rimAlpha: 0,
      ridgeCapAlpha: 0.35,
      bodyDarken: 0,
      glowGain: 0.15,
      vignette: 0.18,
    },
  },
  sunset: {
    color: {
      window: '#FFE7B0',
      disc: '#FFE7B0',
      l1: '#8A507B',
      whaleLane: '#894E75',
      l2: '#5D366A',
      l3: '#4A2A55',
      l4: '#321C4C',
      seagrass: '#4B2652',
      l5: '#281642',
      l6: '#201036',
      ridgeCap: '#FFC58A',
      ray: '#FFC98A',
      caustic: '#FFD7A1',
      snow: '#FFD9B8',
      bokeh: '#FFC58A',
      rim: '#FFC58A',
      kelpBlade: '#7A3F4C',
      kelpEdge: '#E39A7A',
      seaFanBranch: '#F59A92',
      seaFanPolyp: '#F59A92',
      chestBody: '#4A2433',
      chestBand: '#F2B65A',
      inkTop: '#2A1640',
      inkDeep: '#FBE6DA',
      paper: paperFor.sunset,
    },
    num: {
      windowAlpha: 0.5,
      discAlpha: 0.9,
      rayAlpha: 0.12,
      rayCount: 4,
      rayTiltDeg: 14,
      causticWindowAlpha: 0.04,
      causticSeabedAlpha: 0,
      snowAlpha: 0.26,
      bokehAlpha: 0.1,
      rimAlpha: 1,
      ridgeCapAlpha: 0.35,
      bodyDarken: 0,
      glowGain: 0.5,
      vignette: 0.28,
    },
  },
  midnight: {
    color: {
      window: '#8FA2E8',
      disc: '#D8E2FF',
      l1: '#1F2667',
      whaleLane: '#1B225F',
      l2: '#191F59',
      l3: '#141A4F',
      l4: '#101440',
      seagrass: '#0D1139',
      l5: '#0B0F34',
      l6: '#070927',
      ridgeCap: '#8FA2E8',
      ray: '#9FB4FF',
      caustic: '#FFFFFF',
      snow: '#8FA2E8',
      bokeh: '#8FA2E8',
      rim: '#8FA2E8',
      kelpBlade: '#0D1139',
      kelpEdge: '#0D1139',
      seaFanBranch: '#2A1A44',
      seaFanPolyp: '#FF8FA8',
      chestBody: '#0A0C2C',
      chestBand: '#0A0C2C',
      inkTop: '#E6EAFF',
      inkDeep: '#E6EAFF',
      paper: paperFor.midnight,
    },
    num: {
      windowAlpha: 0.18,
      discAlpha: 0.88,
      rayAlpha: 0.05,
      rayCount: 2,
      rayTiltDeg: 0,
      causticWindowAlpha: 0,
      causticSeabedAlpha: 0,
      snowAlpha: 0.18,
      bokehAlpha: 0.08,
      rimAlpha: 1,
      ridgeCapAlpha: 0.2,
      bodyDarken: 0.4,
      glowGain: 1,
      vignette: 0.38,
    },
  },
};

/** Fog (how far a layer is mixed toward the water color) per landscape layer. */
export const layerFog = { l1: 0.84, whaleLane: 0.72, l2: 0.66, l3: 0.46, l4: 0.24, l5: 0.08, l6: 0 } as const;

/** Layer horizons as a fraction of screen height from the top (used for the descent delay). */
export const layerHorizon = { surface: 0.04, l1: 0.5, whaleLane: 0.43, l2: 0.6, l3: 0.6, jelly: 0.43, l4: 0.72, l5: 0.84, l6: 0.95 } as const;

// ---------------------------------------------------------------------------
// OKLab mixing
// ---------------------------------------------------------------------------

type Lab = [number, number, number];

const labCache = new Map<string, Lab>();

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

/** Parses #RGB, #RRGGBB or rgb(r,g,b) into 0..1 channels. */
export function parseColor(color: string): [number, number, number] {
  if (color[0] === '#') {
    const hex = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : color;
    const n = parseInt(hex.slice(1, 7), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = color.match(/[\d.]+/g);
  if (!m) return [0, 0, 0];
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

export function toLab(color: string): Lab {
  const hit = labCache.get(color);
  if (hit) return hit;
  const [r, g, b] = parseColor(color).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab: Lab = [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
  if (labCache.size > 4096) labCache.clear();
  labCache.set(color, lab);
  return lab;
}

export function fromLab([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Mixes by a, then b, then the quantized t: a hit builds no key string (mixOK runs hundreds of times a frame). */
const mixCache = new Map<string, Map<string, (string | undefined)[]>>();
let mixCount = 0;
const MIX_CACHE = 8192;

/**
 * Mixes two colors in OKLab. t=0 gives a, t=1 gives b. Results are cached with t
 * quantized to 1/128, so calling this every frame is cheap.
 */
export function mixOK(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const q = Math.round(t * 128);
  let byB = mixCache.get(a);
  let slots = byB?.get(b);
  const hit = slots?.[q];
  if (hit !== undefined) return hit;
  const la = toLab(a);
  const lb = toLab(b);
  const k = q / 128;
  const out = fromLab([la[0] + (lb[0] - la[0]) * k, la[1] + (lb[1] - la[1]) * k, la[2] + (lb[2] - la[2]) * k]);
  if (mixCount >= MIX_CACHE) {
    mixCache.clear();
    mixCount = 0;
    byB = undefined;
    slots = undefined;
  }
  if (!byB) {
    byB = new Map();
    mixCache.set(a, byB);
  }
  if (!slots) {
    slots = new Array<string | undefined>(129);
    byB.set(b, slots);
  }
  slots[q] = out;
  mixCount++;
  return out;
}

const adjustCache = new Map<string, Map<number, Map<number, string>>>();
let adjustCount = 0;

/** Adjusts OKLab lightness by `dL` (e.g. +0.08 is noticeably lighter) and chroma by factor `chroma`. Cached. */
export function adjustOK(color: string, dL: number, chroma = 1): string {
  const hit = adjustCache.get(color)?.get(dL)?.get(chroma);
  if (hit !== undefined) return hit;
  const [L, A, B] = toLab(color);
  const out = fromLab([Math.min(1, Math.max(0, L + dL)), A * chroma, B * chroma]);
  if (adjustCount >= 2048) {
    adjustCache.clear();
    adjustCount = 0;
  }
  let byL = adjustCache.get(color);
  if (!byL) {
    byL = new Map();
    adjustCache.set(color, byL);
  }
  let byC = byL.get(dL);
  if (!byC) {
    byC = new Map();
    byL.set(dL, byC);
  }
  byC.set(chroma, out);
  adjustCount++;
  return out;
}

/** Water color at height y (0 top, 1 bottom) for one mode, with no transition. */
export function waterAtMode(mode: LightingMode, y: number): string {
  const stops = waterStops[mode];
  const yy = Math.min(1, Math.max(0, y));
  for (let i = 1; i < stops.length; i++) {
    const [o1, c1] = stops[i];
    if (yy <= o1) {
      const [o0, c0] = stops[i - 1];
      return mixOK(c0, c1, (yy - o0) / (o1 - o0));
    }
  }
  return stops[stops.length - 1][1];
}

/** Applies atmospheric perspective: mixes `color` toward the water behind it by `fog` (0..1). */
export function fogColor(color: string, water: string, fog: number): string {
  return mixOK(color, water, fog);
}

/** "#rrggbb" plus alpha 0..1 as an rgba() string, for canvas fills. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(3)})`;
}

/** Relative luminance (WCAG) of a color, for choosing legible ink. */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
