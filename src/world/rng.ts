/** Seeded randomness so her sea has the same shape on every visit. */
import { gift } from '../config/gift';

export const SEA_SEED = (gift.seaSeed ?? 0x5ea5ed) >>> 0;

export type Rand = () => number;

/** Small fast PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A named sub-stream of the sea seed, e.g. stream("terrain"), stream("jelly:luma"). */
export function stream(name: string, seed: number = SEA_SEED): Rand {
  return mulberry32((seed ^ hashString(name)) >>> 0);
}

/** Random float in [min, max) from a stream. */
export function range(rand: Rand, min: number, max: number): number {
  return min + (max - min) * rand();
}

/**
 * 1D value noise with smooth interpolation. `wavelength` in the same units as x.
 * Returns roughly -1..1.
 */
export function valueNoise1D(rand: Rand, wavelength: number, samples = 256): (x: number) => number {
  const v = Array.from({ length: samples }, () => rand() * 2 - 1);
  return (x: number) => {
    const p = x / wavelength;
    const i = Math.floor(p);
    const f = p - i;
    const a = v[((i % samples) + samples) % samples];
    const b = v[(((i + 1) % samples) + samples) % samples];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}
