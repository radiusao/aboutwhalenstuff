/**
 * The daily note (§7.6): a strip of sea-damp paper that unrolls downward from the bottle,
 * writes itself in line by line, and re-rolls when she keeps it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { animate, motion, useMotionValue, useReducedMotionConfig, useTransform, type AnimationPlaybackControls } from 'framer-motion';
import { useUiState, type OpenNote } from '../uiState';
import { useEngine } from '../../world/EngineContext';
import { useSanctuary } from '../../context/SanctuaryContext';
import { gift } from '../../config/gift';
import { range, stream } from '../../world/rng';
import {
  baselineIn,
  CSS_EASE_ENTER,
  DATE_SIZE,
  DATE_STYLE,
  deckleTop,
  EASE_ENTER,
  EASE_EXIT,
  formatDay,
  HAND,
  ink,
  JOST,
  PAPER_INK,
  today,
  useEscape,
  useFontsReady,
  usingKeyboard,
  useViewport,
  wrapLines,
} from './paper';
import { PaperGrain } from './PaperGrain';

/** Unroll and re-roll, seconds (§7.6, §8.2). */
const UNROLL = 1.1;
const REROLL = 0.6;
/** Handwriting speed, characters per second. */
const CPS = 40;
/** The first line starts once the unroll has uncovered the top of the sheet. */
const WRITE_AT = 0.55;
/** Height of the curl cylinder riding the bottom edge. */
const CURL = 10;
/** Soft edge of the writing sweep, px. */
const FEATHER = 18;
/** Unruled bottom margin that holds "Keep it". */
const FOOT = 58;
const PAD_TOP = 14;
const TILT = -1.2;
/**
 * Phone: where the paper meets the opened bottle. The bottle lies neck up and to the right;
 * its neck starts about 20px right of its centre, and the paper's top edge passes just under
 * it, so the sheet reads as having slid out of the neck.
 */
const NECK_DX = 20;
const NECK_DY = 4;

const SWEEP_FROM = { maskSize: '0% 100%', webkitMaskSize: '0% 100%' };
const SWEEP_TO = { maskSize: '100% 100%', webkitMaskSize: '100% 100%' };

/** A line hidden behind a left-to-right mask until its pen reaches it. */
function sweepStyle(hidden: boolean): CSSProperties {
  if (!hidden) return {};
  const image = `linear-gradient(90deg, #000 calc(100% - ${FEATHER}px), transparent)`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskSize: '0% 100%',
    WebkitMaskSize: '0% 100%',
  };
}

/** Shown while the UI state holds an open note. */
export function NotePaper() {
  const { panel, note } = useUiState();
  const ready = useFontsReady();
  if (panel !== 'note' || !note || !ready) return null;
  return <Note key={`${note.message.id}:${Math.round(note.anchor.x)}:${Math.round(note.anchor.y)}`} note={note} />;
}

function Note({ note }: { note: OpenNote }) {
  const ui = useUiState();
  const engine = useEngine();
  const { state } = useSanctuary();
  const reduced = useReducedMotionConfig() ?? false;
  const vp = useViewport();
  const { phone } = vp;

  const lh = phone ? 32 : 36;
  const size = phone ? 20 : 22;
  const width = phone ? Math.min(320, vp.w - 40 - vp.safe.left - vp.safe.right) : 360;
  const padL = phone ? 22 : 28;
  const padR = phone ? 18 : 24;
  const contentW = width - padL - padR;
  const handFont = `400 ${size}px ${HAND}`;

  const id = note.message.id;
  // Today's bottle carries today's date; a reread note keeps the day it first washed in.
  const firstRead = formatDay(state.readMessageDates?.[id]);
  const given = formatDay(note.message.date);
  const date = (note.source === 'bottle' ? given ?? firstRead : firstRead ?? given) ?? today();

  const lines = useMemo(() => {
    const r = stream(`note:${id}`);
    return wrapLines(note.message.content, handFont, contentW, size * 0.01).map((text) => ({
      text,
      rot: range(r, -0.4, 0.4),
      dy: range(r, -1, 1),
      dur: Math.max(0.2, text.length / CPS),
    }));
  }, [id, note.message.content, handFont, contentW, size]);

  const rows = lines.length + 2;
  const height = PAD_TOP + rows * lh + FOOT;

  const m = useMemo(() => {
    const base = baselineIn(HAND, size, lh);
    const rule = Math.round(base + 2);
    return {
      rule,
      date: rule - 4 - baselineIn(JOST, DATE_SIZE, lh),
      sig: rule - 1 - baselineIn(HAND, 26, lh),
    };
  }, [size, lh]);

  const deckle = useMemo(() => deckleTop(id), [id]);

  // Anchored to the bottle, never to the viewport centre, and kept inside the safe areas.
  const pos = useMemo(() => {
    const { w, h, safe } = vp;
    const a = note.anchor;
    const upper = a.y < h * 0.5;
    const minTop = safe.top + 16;
    const maxBottom = h - safe.bottom - (phone ? 20 : 32);
    let left: number;
    let top: number;
    if (phone) {
      // From the neck, as far right as the screen allows: never equal margins, never centred.
      const minLeft = safe.left + 20;
      const maxLeft = w - safe.right - 20 - width;
      left = Math.max(minLeft, Math.min(maxLeft, a.x + NECK_DX));
      top = upper ? a.y + NECK_DY : a.y - 30 - height;
    } else {
      // To the right of the neck, as if it slid out of it; to the left when there is no room.
      left = a.x + 64 + width <= w - 48 ? a.x + 64 : a.x - 64 - width;
      left = Math.max(48, Math.min(w - 48 - width, left));
      top = upper ? a.y - 22 : a.y + 24 - height;
    }
    top = Math.max(minTop, Math.min(maxBottom - height, top));
    return { left, top };
  }, [vp, note.anchor, phone, width, height]);

  // Unroll: one value drives both the clip and the curl so they never drift apart.
  const p = useMotionValue(reduced ? 1 : 0);
  const fade = useMotionValue(reduced ? 0 : 1);
  const clip = useTransform(p, (v) => `inset(0px 0px ${(height * (1 - v)).toFixed(1)}px 0px)`);
  const curlY = useTransform(p, (v) => Math.max(0, Math.min(height - CURL, v * height - CURL / 2)));
  const curlOpacity = useTransform(p, (v) => Math.min(1, v / 0.04, (1 - v) / 0.08));

  const closing = useRef(false);
  const closeAnim = useRef<AnimationPlaybackControls | null>(null);
  useEffect(() => {
    const c = reduced
      ? animate(fade, 1, { duration: 0.3, ease: EASE_ENTER })
      : animate(p, 1, { duration: UNROLL, ease: EASE_ENTER });
    return () => {
      c.stop();
      closeAnim.current?.stop();
    };
  }, [reduced, p, fade]);

  // Writing: each line sweeps in at 40 characters per second, then the signature, then "Keep it".
  const lineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const sigRef = useRef<HTMLSpanElement | null>(null);
  const sigPathRef = useRef<SVGPathElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const writing = useRef<Animation[]>([]);
  const [written, setWritten] = useState(reduced);
  const writtenRef = useRef(reduced);

  useLayoutEffect(() => {
    if (writtenRef.current) return;
    const list: Animation[] = [];
    let t = WRITE_AT * 1000;
    lines.forEach((l, i) => {
      const el = lineRefs.current[i];
      if (!el) return;
      list.push(el.animate([SWEEP_FROM, SWEEP_TO], { duration: l.dur * 1000, delay: t, easing: 'linear', fill: 'both' }));
      t += l.dur * 1000;
    });
    if (sigPathRef.current) {
      list.push(
        sigPathRef.current.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: 900,
          delay: t + 120,
          easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
          fill: 'both',
        }),
      );
      t += 1020;
    } else if (sigRef.current) {
      list.push(sigRef.current.animate([SWEEP_FROM, SWEEP_TO], { duration: 520, delay: t + 120, easing: 'linear', fill: 'both' }));
      t += 640;
    }
    if (keepRef.current) {
      list.push(
        keepRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: t, easing: CSS_EASE_ENTER, fill: 'both' }),
      );
    }
    writing.current = list;
    Promise.all(list.map((a) => a.finished)).then(
      () => {
        writtenRef.current = true;
        setWritten(true);
      },
      () => {},
    );
    return () => list.forEach((a) => a.cancel());
  }, [lines]);

  const finishWriting = useCallback(() => {
    writing.current.forEach((a) => a.finish());
  }, []);

  useEffect(() => {
    if (usingKeyboard()) keepRef.current?.focus({ preventScroll: true });
  }, []);

  // Today's bottle must always go back to the shelf, even if something else closes the panel.
  const bottleBack = useRef(note.source !== 'bottle');
  const sendBottleBack = useCallback(() => {
    if (bottleBack.current) return;
    bottleBack.current = true;
    engine.closeBottle();
  }, [engine]);
  const unmountTimer = useRef(0);
  useEffect(() => {
    // Deferred, so StrictMode's dev-only remount doesn't sink the bottle on open.
    window.clearTimeout(unmountTimer.current);
    return () => {
      unmountTimer.current = window.setTimeout(sendBottleBack, 0);
    };
  }, [sendBottleBack]);

  const uiRef = useRef(ui);
  uiRef.current = ui;
  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const done = () => {
      sendBottleBack();
      uiRef.current.closePanel();
    };
    closeAnim.current = reduced
      ? animate(fade, 0, { duration: 0.25, ease: EASE_EXIT, onComplete: done })
      : animate(p, 0, { duration: REROLL, ease: EASE_EXIT, onComplete: done });
  }, [sendBottleBack, reduced, fade, p]);

  useEscape(dismiss);

  const hidden = !written && !reduced;
  const ruleImage = `repeating-linear-gradient(to bottom, transparent 0 ${m.rule}px, ${ink(0.1)} ${m.rule}px ${m.rule + 1}px, transparent ${m.rule + 1}px ${lh}px)`;
  const sigTop = PAD_TOP + (lines.length + 1) * lh;
  const sigLeft = padL + Math.round(contentW * 0.58);
  const sigH = Math.round(lh * 1.15);

  return (
    <div className="fixed inset-0 z-40" onClick={dismiss} style={{ touchAction: 'none' }}>
      <div
        className="absolute"
        style={{ left: pos.left, top: pos.top, width, height, transform: `rotate(${TILT}deg)`, transformOrigin: '0 0' }}
      >
        <motion.div
          role="dialog"
          aria-label="A note for you"
          className="absolute inset-0"
          style={{ opacity: fade }}
          onClick={(e) => {
            e.stopPropagation();
            finishWriting();
          }}
        >
          <motion.div className="absolute inset-0" style={{ clipPath: clip, WebkitClipPath: clip }}>
            <div className="absolute inset-0" style={{ background: 'var(--paper)', clipPath: deckle, WebkitClipPath: deckle }}>
              <div
                className="absolute inset-x-0"
                style={{ top: PAD_TOP, height: rows * lh, backgroundImage: ruleImage }}
                aria-hidden="true"
              />
              <PaperGrain seed={id} width={width} height={height} />

              <time
                className="absolute whitespace-nowrap"
                dateTime={date}
                style={{
                  ...DATE_STYLE,
                  left: padL,
                  top: PAD_TOP + m.date,
                  lineHeight: `${lh}px`,
                  color: ink(0.72),
                }}
              >
                {date}
              </time>

              <div
                className="absolute font-hand"
                style={{ left: padL, top: PAD_TOP + lh, fontSize: size, lineHeight: `${lh}px`, letterSpacing: '0.01em', color: PAPER_INK }}
              >
                {lines.map((l, i) => (
                  <span
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className="block w-max whitespace-pre"
                    style={{
                      height: lh,
                      paddingRight: FEATHER,
                      transform: `translateY(${l.dy.toFixed(2)}px) rotate(${l.rot.toFixed(3)}deg)`,
                      transformOrigin: '0 70%',
                      ...sweepStyle(hidden),
                    }}
                  >
                    {l.text}
                  </span>
                ))}
              </div>

              {gift.signaturePath ? (
                <svg
                  className="absolute"
                  viewBox="0 0 200 60"
                  width={(sigH * 200) / 60}
                  height={sigH}
                  style={{ left: Math.min(sigLeft, width - padR - (sigH * 200) / 60), top: sigTop + m.rule + 5 - sigH, overflow: 'visible' }}
                  aria-label={`Signed, ${gift.fromInitial}`}
                  role="img"
                >
                  <path
                    ref={sigPathRef}
                    d={gift.signaturePath}
                    fill="none"
                    stroke={PAPER_INK}
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray="1"
                    strokeDashoffset={hidden ? 1 : 0}
                  />
                </svg>
              ) : (
                <span
                  ref={sigRef}
                  className="absolute block w-max whitespace-pre font-hand"
                  style={{
                    left: sigLeft,
                    top: sigTop + m.sig,
                    fontSize: 26,
                    lineHeight: `${lh}px`,
                    letterSpacing: '0.01em',
                    color: PAPER_INK,
                    paddingRight: FEATHER,
                    ...sweepStyle(hidden),
                  }}
                >
                  {`— ${gift.fromInitial}.`}
                </span>
              )}
            </div>

            <button
              ref={keepRef}
              type="button"
              className="group absolute whitespace-nowrap"
              style={{
                right: padR - 10,
                bottom: 8,
                height: 44,
                minWidth: 44,
                padding: '0 10px',
                outline: 'none',
                fontFamily: JOST,
                fontWeight: 400,
                fontSize: 15,
                lineHeight: '44px',
                color: PAPER_INK,
                opacity: hidden ? 0 : 1,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!writtenRef.current) finishWriting();
                else dismiss();
              }}
            >
              <span className="text-action group-focus-visible:outline-1 group-focus-visible:outline-offset-4 group-focus-visible:outline-solid">
                Keep it
              </span>
            </button>
          </motion.div>

          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{
              height: CURL,
              y: curlY,
              opacity: curlOpacity,
              background:
                'linear-gradient(to bottom, var(--paper), color-mix(in oklab, var(--paper), #000 18%) 55%, var(--paper))',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
