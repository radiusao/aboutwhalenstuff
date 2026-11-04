/**
 * Shared helpers for the note paper and the letters strip: dates, deckled edges,
 * handwriting line breaks, font metrics, the viewport and the safe-area insets.
 */
import { useEffect, useState } from 'react';
import { stream, type Rand } from '../../world/rng';
import { localDay } from '../../utils/day';

export const PAPER_INK = '#1D2458';
export const HAND = '"Nothing You Could Do", "Segoe Print", cursive';
export const JOST = 'Jost, Futura, "Avenir Next", sans-serif';

/**
 * Dates on the note and in the letters strip ("14 Oct 2026"): a quiet stamp in Jost with
 * tabular figures and a little tracking. Not DM Mono, whose slashed zero read as code.
 */
export const DATE_SIZE = 12;
export const DATE_STYLE = {
  fontFamily: JOST,
  fontWeight: 400,
  fontSize: DATE_SIZE,
  letterSpacing: '0.06em',
  fontVariantNumeric: 'tabular-nums',
} as const;

/** §8.2 easing tokens as Framer / WAAPI curves. */
export const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_EXIT: [number, number, number, number] = [0.7, 0, 0.84, 0];
export const CSS_EASE_ENTER = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Ink on paper at a given strength, e.g. 0.6 for dates. */
export const ink = (alpha: number) => `rgba(29, 36, 88, ${alpha})`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-14" (a local day) as "14 Oct 2026". Null when the day is missing or malformed. */
export function formatDay(day: string | null | undefined): string | null {
  const m = day?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/** Today as "14 Oct 2026". */
export const today = () => formatDay(localDay())!;

/** Gently smoothed jitter in [-1, 1]: a deckle is torn fibre, not a zigzag. */
function jitter(rand: Rand, n: number): number[] {
  const raw = Array.from({ length: n }, () => rand() * 2 - 1);
  return raw.map((v, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[Math.min(n - 1, i + 1)];
    const s = v * 0.6 + (a + b) * 0.2;
    return Math.max(-1, Math.min(1, s * 1.35));
  });
}

/** clip-path with a deckled top edge (n points, ±amp px) and square sides and bottom. */
export function deckleTop(seed: string, n = 30, amp = 1.5): string {
  const j = jitter(stream(`deckle:${seed}`), n);
  const pts = j.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)}% ${(amp + v * amp).toFixed(2)}px`);
  return `polygon(${pts.join(', ')}, 100% 100%, 0% 100%)`;
}

/**
 * clip-path for a strip torn along its left and bottom edges (±amp px, about one point every
 * 13px of each edge), square along the top and right where it meets the screen edges.
 */
export function deckleLeftBottom(seed: string, width: number, height: number, amp = 1.5): string {
  const nb = Math.max(8, Math.round(width / 13));
  const nl = Math.max(6, Math.round(height / 13));
  const bottom = jitter(stream(`deckle:${seed}:bottom`), nb);
  const left = jitter(stream(`deckle:${seed}:left`), nl);
  const inset = (v: number) => `${(amp + v * amp).toFixed(2)}px`;
  const pts: string[] = [];
  // Along the bottom, right to left; the corner is one point shared by both torn edges.
  for (let i = 0; i < nb - 1; i++) pts.push(`${((1 - i / (nb - 1)) * 100).toFixed(2)}% calc(100% - ${inset(bottom[i])})`);
  pts.push(`${inset(left[0])} calc(100% - ${inset(bottom[nb - 1])})`);
  // Up the left edge to the top.
  for (let i = 1; i < nl; i++) pts.push(`${inset(left[i])} ${((1 - i / (nl - 1)) * 100).toFixed(2)}%`);
  return `polygon(0% 0%, 100% 0%, ${pts.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Text measurement (canvas, after the fonts have loaded)
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D | null {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Width of `text` in px, including CSS letter-spacing. */
export function textWidth(text: string, font: string, letterSpacing = 0): number {
  const c = ctx2d();
  if (!c) return text.length * 9;
  c.font = font;
  return c.measureText(text).width + letterSpacing * text.length;
}

/** Breaks text into lines no wider than maxWidth (explicit newlines are kept). */
export function wrapLines(text: string, font: string, maxWidth: number, letterSpacing = 0): string[] {
  const out: string[] = [];
  for (const para of text.trim().split(/\n/)) {
    const start = out.length;
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, font, letterSpacing) > maxWidth) {
        // Never leave a lone "I" or "a" hanging at the end of a line.
        const m = line.match(/^(.*\S)\s+(\S)$/);
        if (m && m[1].includes(' ')) {
          out.push(m[1]);
          line = `${m[2]} ${word}`;
        } else {
          out.push(line);
          line = word;
        }
      } else line = next;
    }
    if (line) out.push(line);
    // No single-word last line: bring the word before it down to keep it company,
    // and never strand an "a" or "I" at the end of the line it leaves.
    const n = out.length;
    if (n - start >= 2 && !/\s/.test(out[n - 1])) {
      const prev = out[n - 2].split(' ');
      let moved = `${prev.pop()} ${out[n - 1]}`;
      if (prev.length >= 3 && prev[prev.length - 1].length === 1) moved = `${prev.pop()} ${moved}`;
      if (prev.length >= 2 && textWidth(moved, font, letterSpacing) <= maxWidth) {
        out[n - 2] = prev.join(' ');
        out[n - 1] = moved;
      }
    }
  }
  return out;
}

const baselineCache = new Map<string, number>();

/**
 * Distance from the top of a CSS line box to the alphabetic baseline of its text, measured
 * in the DOM (a zero-height inline-block sits on the baseline), so rules line up exactly.
 */
export function baselineIn(family: string, size: number, lineHeight: number, weight = 400): number {
  const key = `${weight}|${size}|${lineHeight}|${family}`;
  const hit = baselineCache.get(key);
  if (hit !== undefined) return hit;
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:${weight} ${size}px/${lineHeight}px ${family}`;
  box.textContent = 'Hxg';
  const mark = document.createElement('span');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  box.appendChild(mark);
  document.body.appendChild(box);
  const y = mark.offsetTop;
  box.remove();
  const value = y > 0 ? y : lineHeight * 0.68;
  if (y > 0 && document.fonts.check(`${weight} ${size}px ${family}`)) baselineCache.set(key, value);
  return value;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const FONT_LOADS = [`400 22px ${HAND}`, `400 ${DATE_SIZE}px ${JOST}`, `400 15px ${JOST}`, `300 15px ${JOST}`, `500 12px ${JOST}`];

function fontsAlreadyLoaded(): boolean {
  try {
    return FONT_LOADS.every((f) => document.fonts.check(f));
  } catch {
    return true;
  }
}

/** True once the paper's fonts are loaded (or after 1.5s, so a slow network never blocks a note). */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(fontsAlreadyLoaded);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    const done = () => {
      if (alive) setReady(true);
    };
    const timer = window.setTimeout(done, 1500);
    Promise.all(FONT_LOADS.map((f) => document.fonts.load(f))).then(done, done);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ready]);
  return ready;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  w: number;
  h: number;
  /** Same breakpoint as the engine (w < 640). */
  phone: boolean;
  safe: Insets;
}

let probe: HTMLDivElement | null = null;
function readInsets(): Insets {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:var(--sat,env(safe-area-inset-top)) var(--sar,env(safe-area-inset-right)) ' +
      'var(--sab,env(safe-area-inset-bottom)) var(--sal,env(safe-area-inset-left))';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string) => parseFloat(v) || 0;
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

function readViewport(): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { w, h, phone: w < 640, safe: readInsets() };
}

/** Viewport size and safe-area insets, updated on resize and rotation. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    const on = () => setVp(readViewport());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return vp;
}

let keyboardModality = false;
window.addEventListener('keydown', (e) => {
  if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboardModality = true;
}, true);
window.addEventListener('pointerdown', () => {
  keyboardModality = false;
}, true);

/** True when the last input was a key press, so moving focus helps (and its ring is wanted). */
export const usingKeyboard = () => keyboardModality;

/** Calls `cb` on Escape while mounted. */
export function useEscape(cb: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [cb]);
}
