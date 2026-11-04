/**
 * Small helpers shared by the overlay components: easing tokens (§8.2), mode names,
 * the phone breakpoint and ink choice.
 */
import { useEffect, useState } from 'react';
import type { LightingMode } from '../../types/sanctuary';
import { contrastRatio, modeTokens } from '../../world/palette';

type Bezier = [number, number, number, number];

/** UI in. */
export const EASE_ENTER: Bezier = [0.16, 1, 0.3, 1];
/** UI out. */
export const EASE_EXIT: Bezier = [0.7, 0, 0.84, 0];
/** Ambient glides (sine in-out). */
export const EASE_DRIFT: Bezier = [0.37, 0, 0.63, 1];

export const MODE_CYCLE: LightingMode[] = ['day', 'sunset', 'midnight'];
export const MODE_NAME: Record<LightingMode, string> = { day: 'Day', sunset: 'Sunset', midnight: 'Midnight' };

export function nextMode(mode: LightingMode): LightingMode {
  return MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length];
}

const PHONE_QUERY = '(max-width: 639.98px)';

/** True on narrow screens (under 640px), matching WorldFrame.phone. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** Which ink reads better against `water` in this mode (callouts, relocated captions). */
export function betterInk(mode: LightingMode, water: string): 'top' | 'deep' {
  const t = modeTokens[mode].color;
  return contrastRatio(t.inkTop, water) >= contrastRatio(t.inkDeep, water) ? 'top' : 'deep';
}

export const INK_VAR = { top: 'var(--ink-top)', deep: 'var(--ink-deep)' } as const;

/** A CSS color: `color` at `pct` percent over transparent. */
export function fade(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Height of the open shop as a fraction of the viewport (§7.5). */
export function shopFraction(phone: boolean): number {
  return phone ? 0.62 : 0.46;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of `text` set in `font` (a canvas font string), in CSS px. */
export function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** A CSS length (e.g. `var(--sat)`) resolved to px. */
export function cssPx(length: string): number {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;visibility:hidden;top:0;left:0;width:0;height:${length}`;
  document.body.appendChild(el);
  const px = el.getBoundingClientRect().height;
  el.remove();
  return px;
}
