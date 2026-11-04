/**
 * Letters (§7.7): a strip of the note paper hanging from the top of the right edge, listing
 * every note she has opened, newest first. It is only as long as its letters, torn along the
 * left and bottom, and grows toward the full height as letters gather (then scrolls).
 * Tapping one rerolls it out beside the kept bottles.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useUiState } from '../uiState';
import { useSanctuary } from '../../context/SanctuaryContext';
import { bottleMessages } from '../../data/messages';
import type { BottleMessage } from '../../types/sanctuary';
import {
  DATE_STYLE,
  deckleLeftBottom,
  EASE_ENTER,
  EASE_EXIT,
  formatDay,
  HAND,
  ink,
  PAPER_INK,
  textWidth,
  useEscape,
  useFontsReady,
  usingKeyboard,
  useViewport,
  wrapLines,
} from './paper';

/** Where a reread note unrolls: just above the kept-bottle shelf. */
const SHELF_ANCHOR = { x: 0.45, y: 0.72 };
/** The strip has slid away (350ms ease-exit) before the paper starts to unroll. */
const HANDOFF_MS = 340;
const EXIT = { duration: 0.35, ease: EASE_EXIT };
/** Fade where the list scrolls under the header and under the torn bottom edge. */
const SCROLL_MASK = 'linear-gradient(to bottom, transparent 0, #000 18px, #000 calc(100% - 22px), transparent 100%)';

/** Mounted with the rest of the overlay; shows itself while the letters panel is open. */
export function Letters() {
  const { panel } = useUiState();
  return <AnimatePresence>{panel === 'letters' && <Strip key="letters" />}</AnimatePresence>;
}

function Strip() {
  const ui = useUiState();
  const { state, bottleAvailable } = useSanctuary();
  const vp = useViewport();
  const fontsReady = useFontsReady();
  const reduced = useReducedMotionConfig() ?? false;
  const { phone, safe } = vp;

  const width = phone ? vp.w - 20 : 380;
  const padL = phone ? 20 : 36;
  const padR = phone ? 20 + safe.right : Math.max(48, safe.right + 20);
  const handSize = phone ? 18 : 19;

  const uiRef = useRef(ui);
  uiRef.current = ui;
  // Rereading hands the panel straight from the strip to the note, so the HUD never flickers back between them.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const handoff = useRef(0);
  useEffect(() => () => window.clearTimeout(handoff.current), []);
  const close = useMemo(
    () => () => {
      if (!leavingRef.current) uiRef.current.closePanel();
    },
    [],
  );
  useEscape(close);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (usingKeyboard()) closeRef.current?.focus({ preventScroll: true });
  }, []);

  const entries = useMemo(() => {
    const byId = new Map(bottleMessages.map((m) => [m.id, m]));
    const font = `400 ${handSize}px ${HAND}`;
    const maxW = width - padL - padR - 4 - (fontsReady ? textWidth('\u2026', font) : 12);
    return [...state.readMessageIds].reverse().flatMap((id) => {
      const message = byId.get(id);
      if (!message) return [];
      const day = state.readMessageDates?.[id] ?? null;
      const lines = fontsReady ? wrapLines(message.content, font, maxW, handSize * 0.01) : [message.content];
      const first = lines.length > 1 ? `${lines[0].replace(/[,;:.\s]+$/, '')}…` : lines[0];
      return [{ id, message, day, date: formatDay(day), first }];
    });
  }, [state.readMessageIds, state.readMessageDates, width, padL, padR, handSize, fontsReady]);

  const reread = (message: BottleMessage, day: string | null) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    handoff.current = window.setTimeout(() => {
      uiRef.current.showNote({
        message: { ...message, date: day ?? '', readStatus: true },
        anchor: { x: window.innerWidth * SHELF_ANCHOR.x, y: window.innerHeight * SHELF_ANCHOR.y },
        source: 'shelf',
      });
    }, HANDOFF_MS);
  };

  // The sheet hugs its letters; at most it reaches the bottom of the screen, short of the home
  // indicator, so its torn edge always shows.
  const maxH = vp.h - Math.max(phone ? 16 : 24, safe.bottom);
  const paperRef = useRef<HTMLDivElement>(null);
  const [paperH, setPaperH] = useState(0);
  useLayoutEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const measure = () => setPaperH(Math.round(el.offsetHeight / 8) * 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const deckle = useMemo(() => deckleLeftBottom('letters', width, paperH || maxH), [width, paperH, maxH]);
  const shift = reduced ? 0 : 8;

  return (
    <>
      <motion.div className="fixed inset-0 z-30" onClick={close} exit={{ opacity: 1 }} style={{ touchAction: 'none' }} />
      <motion.aside
        role="dialog"
        aria-label="Letters"
        className="fixed top-0 right-0 z-30"
        style={{ width }}
        initial={{ opacity: 0, x: shift }}
        animate={leaving ? { opacity: 0, x: shift, transition: EXIT } : { opacity: 1, x: 0, transition: { duration: 0.7, ease: EASE_ENTER } }}
        exit={{ opacity: 0, x: shift, transition: EXIT }}
      >
        <div
          ref={paperRef}
          className="overflow-hidden"
          style={{ maxHeight: maxH, background: 'var(--paper)', clipPath: deckle, WebkitClipPath: deckle }}
        >
          <div className="flex flex-col" style={{ maxHeight: maxH }}>
            {/* Sits where the HUD row sits, so CLOSE lands where LETTERS was tapped. */}
            <div className="flex shrink-0 justify-end" style={{ paddingTop: phone ? safe.top + 6 : Math.max(38, safe.top + 6), paddingRight: padR - 12 }}>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close letters"
                className="group font-jost uppercase"
                style={{
                  height: 44,
                  minWidth: 44,
                  padding: `${phone ? 13 : 12}px 12px 0`,
                  outline: 'none',
                  alignSelf: 'flex-start',
                  fontWeight: 500,
                  fontSize: 12,
                  lineHeight: '12px',
                  letterSpacing: '0.18em',
                  color: PAPER_INK,
                }}
                onClick={close}
              >
                <span
                  className="grow-underline inline-block group-focus-visible:outline-1 group-focus-visible:outline-offset-4 group-focus-visible:outline-solid"
                  style={{ marginRight: '-0.18em', paddingBottom: 4 }}
                >
                  Close
                </span>
              </button>
            </div>

            <div
              className="min-h-0 shrink overflow-y-auto"
              style={{
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                paddingLeft: padL,
                paddingRight: padR,
                paddingBottom: phone ? 30 : 40,
                maskImage: SCROLL_MASK,
                WebkitMaskImage: SCROLL_MASK,
              }}
            >
              {entries.length === 0 ? (
                <p className="font-jost" style={{ paddingTop: 22, fontWeight: 300, fontSize: 15, lineHeight: 1.4, color: ink(0.72), maxWidth: '30ch' }}>
                  No letters yet. The first bottle is on its way.
                </p>
              ) : (
                <>
                  <ul style={{ paddingTop: 10 }}>
                    {entries.map((e, i) => (
                      <li key={e.id} style={{ borderTop: i ? `1px solid ${ink(0.15)}` : undefined }}>
                        <button
                          type="button"
                          className="block w-full text-left"
                          style={{ padding: '15px 0 13px', minHeight: 44, outlineOffset: 2, color: PAPER_INK }}
                          onClick={() => reread(e.message, e.day)}
                        >
                          {e.date && (
                            <span className="block" style={{ ...DATE_STYLE, lineHeight: '16px', color: ink(0.72) }}>
                              {e.date}
                            </span>
                          )}
                          <span
                            className="block overflow-hidden whitespace-nowrap font-hand"
                            style={{ fontSize: handSize, lineHeight: '30px', letterSpacing: '0.01em', color: PAPER_INK }}
                          >
                            {e.first}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="font-jost" style={{ paddingTop: 26, fontWeight: 300, fontSize: 15, lineHeight: 1.4, color: ink(0.72) }}>
                    {bottleAvailable ? "Today's bottle is still out there." : 'Another bottle drifts in tomorrow.'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
