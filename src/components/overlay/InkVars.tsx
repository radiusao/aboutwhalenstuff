/**
 * Keeps the mode-driven CSS variables on <html> in step with "Light descends" (§8.5):
 * --ink-top switches once the top band has darkened or lightened enough to favour the new ink
 * (lighting.inkStart, about 0.6-1s) and --ink-deep at 2.4s; the scrim colours follow
 * the water at their own height (delay = y * 2.4s, then a 1.6s blend), all in OKLab.
 * The descent clock starts on the engine's first 'descent' event; if none comes (instant
 * mode changes), it falls back to a 1.2s crossfade.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { LightingMode } from '../../types/sanctuary';
import { mixOK, modeTokens, paperFor, waterAtMode } from '../../world/palette';
import { useEngineEvent } from '../../world/EngineContext';
import { inkStart } from '../../world/lighting';
import { useSanctuary } from '../../context/SanctuaryContext';

type VarName = '--ink-top' | '--ink-deep' | '--paper' | '--scrim' | '--scrim-top' | '--bg';
type Vars = Record<VarName, string>;

const NAMES: VarName[] = ['--ink-top', '--ink-deep', '--paper', '--scrim', '--scrim-top', '--bg'];

/** [start, blend] in seconds after the descent begins. */
const TIMING: Record<VarName, [number, number]> = {
  '--ink-top': [0.3, 0.4],
  '--ink-deep': [2.4, 0.4],
  '--paper': [2.4, 0.4],
  '--scrim-top': [0.08 * 2.4, 1.6],
  '--bg': [0.5 * 2.4, 1.6],
  '--scrim': [2.4, 1.6],
};
/** Leaving Midnight, the lanterns go out for 1s before the daylight starts to sink. */
const LIGHTS_OUT = 1;
const CROSSFADE = 1.2;
/** How long to wait for the engine to start a descent before crossfading anyway. */
const FALLBACK_MS = 4500;

function varsFor(mode: LightingMode): Vars {
  const c = modeTokens[mode].color;
  return {
    '--ink-top': c.inkTop,
    '--ink-deep': c.inkDeep,
    '--paper': paperFor[mode],
    '--scrim': waterAtMode(mode, 1),
    '--scrim-top': waterAtMode(mode, 0.08),
    '--bg': waterAtMode(mode, 0.5),
  };
}

const sine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, s)));

interface Blend {
  to: LightingMode;
  fromMode: LightingMode;
  from: Vars;
  target: Vars;
  start: number;
  out: number;
  crossfade: boolean;
}

export function InkVars() {
  const { state } = useSanctuary();
  const mode = state.activeLighting;
  const reduced = useReducedMotion() ?? false;

  const current = useRef<Vars | null>(null);
  const target = useRef<LightingMode>(mode);
  const blend = useRef<Blend | null>(null);
  const raf = useRef(0);
  const fallback = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const write = (v: Vars) => {
    const style = document.documentElement.style;
    const prev = current.current;
    for (const n of NAMES) if (!prev || prev[n] !== v[n]) style.setProperty(n, v[n]);
    current.current = v;
  };

  const tick = () => {
    const b = blend.current;
    if (!b) return;
    const t = (performance.now() - b.start) / 1000;
    const next = {} as Vars;
    let done = true;
    for (const n of NAMES) {
      const start = n === '--ink-top' ? inkStart(b.fromMode, b.to, 'inkTop') : TIMING[n][0];
      const [s, d] = b.crossfade ? [0, CROSSFADE] : [start + b.out, TIMING[n][1]];
      const k = sine((t - s) / d);
      if (k < 1) done = false;
      next[n] = mixOK(b.from[n], b.target[n], k);
    }
    write(next);
    if (done) {
      blend.current = null;
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };

  const begin = (to: LightingMode, from: LightingMode, crossfade: boolean) => {
    window.clearTimeout(fallback.current);
    cancelAnimationFrame(raf.current);
    target.current = to;
    blend.current = {
      to,
      fromMode: from,
      from: current.current ?? varsFor(from),
      target: varsFor(to),
      start: performance.now(),
      out: from === 'midnight' && to !== 'midnight' ? LIGHTS_OUT : 0,
      crossfade: crossfade || reducedRef.current,
    };
    raf.current = requestAnimationFrame(tick);
  };

  // First paint: set the inks for the opening mode at once.
  useEffect(() => {
    write(varsFor(target.current));
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(fallback.current);
    };
  }, []);

  // Mode changed in saved state: wait for the engine's descent to start the clock.
  useEffect(() => {
    if (mode === target.current) return;
    window.clearTimeout(fallback.current);
    fallback.current = window.setTimeout(() => {
      if (target.current !== mode) begin(mode, target.current, true);
    }, FALLBACK_MS);
  }, [mode]);

  useEngineEvent('descent', (e) => {
    if (e.progress >= 1) {
      if (!blend.current && e.to !== target.current) begin(e.to, e.from, true);
      return;
    }
    if (e.to !== target.current) begin(e.to, e.from, false);
  });

  return null;
}
