/**
 * The DOM overlay set straight onto the sea: inks, HUD, depth gauge, callouts, floaters,
 * captions and title card, the edition mark and the accessibility mirror. Place it inside
 * SanctuaryProvider, UiStateProvider and EngineProvider, after the canvas.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSanctuary } from '../../context/SanctuaryContext';
import { waterAtMode } from '../../world/palette';
import { useUiState } from '../uiState';
import { A11yLayer } from './A11yLayer';
import { Callout } from './Callout';
import { Captions } from './Captions';
import { DepthGauge } from './DepthGauge';
import { EditionMark } from './EditionMark';
import { Floaters } from './Floaters';
import { Hud } from './Hud';
import { InkVars } from './InkVars';
import { TitleCard, TitleCardOpenWater, useTitleCard, type TitleState } from './TitleCard';
import { betterInk, cssPx, EASE_ENTER, INK_VAR, shopFraction, useIsPhone } from './shared';
import './overlay.css';

/**
 * Lower-left column: the title card above (desktop), captions below. Lifts above the shop
 * while it is open. Its scrim fades away when the column is empty.
 */
function LowerLeft({ title }: { title: TitleState | null }) {
  const { panel } = useUiState();
  const { state } = useSanctuary();
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  // A short landscape screen gives the shop all the water below the HUD: no room for the column.
  const [crowded, setCrowded] = useState(false);
  const shop = panel === 'shop';

  useLayoutEffect(() => {
    const el = ref.current;
    if (!shop || !el) {
      setLift(0);
      setCrowded(false);
      return;
    }
    // Resting bottom edge of the column (without the lift), then raise it to just above the shop.
    const h = window.innerHeight;
    const rest = h - el.getBoundingClientRect().bottom - lift;
    let next = Math.max(0, shopFraction(phone) * h + 24 - rest);
    // Where the shop's type actually starts (its tabs), when it is taller than its usual share.
    const panelEl = document.querySelector<HTMLElement>('.shop-panel');
    const tops = panelEl ? Array.from(panelEl.children, (c) => c.getBoundingClientRect().top) : [];
    const shopTop = tops.length ? Math.min(...tops) : h;
    if (h - rest - next > shopTop - 24) next = Math.max(0, h - shopTop + 24 - rest);
    // Room for at least one caption line between the HUD row and the shop.
    setCrowded(h - rest - next - 64 < cssPx('var(--sat)') + 96);
    setLift(next);
  }, [shop, phone]);

  // Above the shop the captions sit in open water, so they take whichever ink reads there.
  const ink = shop ? betterInk(state.activeLighting, waterAtMode(state.activeLighting, 1 - shopFraction(phone) - 0.04)) : 'deep';

  return (
    <motion.div
      ref={ref}
      className="qf-lowerleft pointer-events-none absolute left-[calc(var(--sal)+20px)] bottom-[calc(var(--sab)+50px)] max-w-[calc(100%-40px)] sm:left-[max(48px,calc(var(--sal)+20px))] sm:bottom-[max(48px,calc(var(--sab)+20px))]"
      style={{ color: INK_VAR[ink] }}
      animate={{ y: -lift, opacity: crowded ? 0 : 1 }}
      transition={{ duration: 0.9, ease: EASE_ENTER, opacity: { duration: crowded ? 0.2 : 0.6 } }}
    >
      <span
        aria-hidden="true"
        className="qf-scrim -inset-x-16 -inset-y-10"
        style={{ ['--qf-scrim-color' as string]: shop ? 'var(--scrim-top)' : 'var(--scrim)' }}
      />
      {title && <TitleCard {...title} />}
      <Captions />
    </motion.div>
  );
}

/**
 * `onBottle` starts the same flow as tapping today's bottle on the canvas (pick the note,
 * then engine.openBottle()); the accessibility mirror's bottle button calls it.
 */
export function Overlay({ onBottle }: { onBottle?: () => void }) {
  const title = useTitleCard();
  const phone = useIsPhone();
  return (
    <div className="qf-overlay pointer-events-none fixed inset-0 z-[25] overflow-hidden select-none">
      <InkVars />
      <EditionMark />
      <LowerLeft title={phone ? null : title} />
      {phone && <TitleCardOpenWater {...title} />}
      <Callout />
      <Floaters />
      <DepthGauge />
      <Hud />
      <A11yLayer onBottle={onBottle} />
    </div>
  );
}
