/**
 * The shop: specimen plates set on a scrim that rises from the seabed. The world keeps
 * running above it (no blur), shifted up by the engine's camera. Closes on Esc, a tap on
 * the water above, or the HUD's CLOSE.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEngine } from '../../world/EngineContext';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useUiState } from '../uiState';
import { lifePlates, seabedPlates, type ShopTab } from './catalog';
import { Plate } from './Plate';
import { setPlateMode } from './stage';
import './shop.css';

const EASE_ENTER = [0.16, 1, 0.3, 1] as const;
const EASE_EXIT = [0.7, 0, 0.84, 0] as const;
const TABS: { id: ShopTab; label: string }[] = [
  { id: 'life', label: 'Life' },
  { id: 'seabed', label: 'Seabed' },
];

const phoneQuery = '(max-width: 639.98px)';
function subscribePhone(cb: () => void) {
  const m = matchMedia(phoneQuery);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}
function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => matchMedia(phoneQuery).matches, () => true);
}

function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Shop() {
  const ui = useUiState();
  const engine = useEngine();
  const mode = useSanctuary().state.activeLighting;
  const open = ui.panel === 'shop';
  const [tab, setTab] = useState<ShopTab>('life');

  useEffect(() => setPlateMode(mode), [mode]);

  useEffect(() => {
    if (!open) return;
    engine.setCameraShift(true);
    return () => engine.setCameraShift(false);
  }, [engine, open]);

  return <AnimatePresence>{open && <ShopLayer key="shop" tab={tab} setTab={setTab} close={ui.closePanel} />}</AnimatePresence>;
}

function ShopLayer({ tab, setTab, close }: { tab: ShopTab; setTab: (t: ShopTab) => void; close: () => void }) {
  const phone = usePhone();
  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLUListElement | null>(null);
  const [stripEl, setStripEl] = useState<HTMLUListElement | null>(null);
  const tabRefs = useRef<Partial<Record<ShopTab, HTMLButtonElement | null>>>({});
  const layerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  // Whatever had focus before the shop opened (usually SHOP), so Esc can hand focus back.
  const opener = useRef(document.activeElement);

  const step = useCallback((dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    if (!items.length) return;
    let cur = 0;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].offsetLeft - el.scrollLeft) < Math.abs(items[cur].offsetLeft - el.scrollLeft)) cur = i;
    }
    const max = el.scrollWidth - el.clientWidth;
    if (dir > 0 && el.scrollLeft >= max - 2) return;
    const next = items[Math.max(0, Math.min(items.length - 1, cur + dir))];
    el.scrollTo({ left: Math.min(max, next.offsetLeft), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (el.contains(document.activeElement)) {
      const target = next.querySelector<HTMLElement>('button') ?? next;
      target.focus({ preventScroll: true });
    }
  }, []);

  // Pad the end of the strip so its last scroll position lands on a plate edge, never mid-plate.
  useEffect(() => {
    const el = stripEl;
    if (!el) return;
    const fit = () => {
      const items = Array.from(el.children) as HTMLElement[];
      const last = items[items.length - 1];
      if (!last) return;
      const overflow = last.offsetLeft + last.offsetWidth - el.clientWidth;
      const edge = items.find((it) => it.offsetLeft >= overflow - 1);
      el.style.paddingRight = overflow > 0 && edge ? `${Math.round(edge.offsetLeft - overflow)}px` : '';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [stripEl]);

  // The backdrop is dense up to just above the shop's highest type (the tabs) and fades out above
  // it. Measured from layout, not the screen, since the phone shop's height is set by its plates.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!layer || !panel || !scrim) return;
    const fit = () => {
      let top = panel.offsetHeight;
      for (const el of Array.from(panel.children) as HTMLElement[]) top = Math.min(top, el.offsetTop);
      const dense = Math.round(layer.clientHeight - panel.offsetTop - top + 14);
      const fade = Math.round(Math.max(140, Math.min(260, dense * 0.5)));
      scrim.style.setProperty('--shop-dense', `${dense}px`);
      scrim.style.setProperty('--shop-fade', `${fade}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(panel);
    ro.observe(layer);
    return () => ro.disconnect();
  }, [phone]);

  // Esc closes; arrow keys move between plates.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const back = opener.current;
        if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
        close();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [close, step]);

  // While the shop is open, a tap on the water above it closes the shop instead of reaching the sea.
  useEffect(() => {
    let down: { x: number; y: number; t: number; id: number } | null = null;
    const onWater = (t: EventTarget | null) => t instanceof HTMLCanvasElement && !panelRef.current?.contains(t);
    const onDown = (e: PointerEvent) => {
      if (!onWater(e.target)) return;
      e.stopPropagation();
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      e.stopPropagation();
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 10 && performance.now() - down.t <= 400;
      down = null;
      if (tap) close();
    };
    const onCancel = (e: PointerEvent) => {
      if (down && e.pointerId === down.id) down = null;
    };
    addEventListener('pointerdown', onDown, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onCancel, true);
    return () => {
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('pointerup', onUp, true);
      removeEventListener('pointercancel', onCancel, true);
    };
  }, [close]);

  // Focus moves into the shop when it opens, so Tab reaches the plates next.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  // Desktop: the vertical wheel turns plates, one per notch (a long flick turns a few).
  useEffect(() => {
    const el = panelRef.current;
    if (!el || phone) return;
    let acc = 0;
    let lockUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now < lockUntil) return;
      acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (Math.abs(acc) < 40) return;
      step(acc > 0 ? 1 : -1);
      acc = 0;
      lockUntil = now + 380;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [phone, step]);

  const onTabKey = (e: KeyboardEvent) => {
    const keys = phone ? [] : ['ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const next = tab === 'life' ? 'seabed' : 'life';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const plates = tab === 'life' ? lifePlates : seabedPlates;
  const dir = tab === 'life' ? -1 : 1;

  return (
    <div ref={layerRef} className="shop pointer-events-none fixed inset-0 z-20 overflow-hidden">
      <motion.div
        ref={scrimRef}
        className="shop-scrim absolute inset-x-0 bottom-0"
        initial={{ opacity: 0, y: '14%' }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_ENTER } }}
        exit={{ opacity: 0, y: '8%', transition: { duration: 0.35, ease: EASE_EXIT } }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label="Shop"
        tabIndex={-1}
        className={`shop-panel pointer-events-auto absolute inset-x-0 bottom-0 ${phone ? 'is-phone' : 'is-desk'}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_ENTER, delay: 0.12 } }}
        exit={{ opacity: 0, y: 8, transition: { duration: 0.35, ease: EASE_EXIT } }}
      >
        <div
          role="tablist"
          aria-label="Shop"
          aria-orientation={phone ? 'horizontal' : 'vertical'}
          className="shop-tabs"
          onKeyDown={onTabKey}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(b) => {
                tabRefs.current[t.id] = b;
              }}
              type="button"
              role="tab"
              id={`shop-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="shop-strip"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`shop-tab font-jost font-light ${tab === t.id ? '' : 'shop-ink-idle'}`}
            >
              <span className="relative">
                {t.label}
                {tab === t.id && (
                  <motion.span
                    layoutId="shop-tab-rule"
                    className="absolute inset-x-0 h-px bg-gold"
                    style={{ bottom: phone ? -5 : -6 }}
                    transition={{ duration: 0.5, ease: EASE_ENTER }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>

        <Strip key={phone ? 'phone' : 'desk'} strip={stripEl} phone={phone} step={step}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.ul
              key={tab}
              ref={(el) => {
                stripRef.current = el;
                if (el) setStripEl(el);
              }}
              id="shop-strip"
              role="tabpanel"
              aria-labelledby={`shop-tab-${tab}`}
              className="shop-strip m-0 list-none p-0"
              initial={{ opacity: 0, x: 8 * -dir }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.55, ease: EASE_ENTER } }}
              exit={{ opacity: 0, x: 8 * dir, transition: { duration: 0.22, ease: EASE_EXIT } }}
            >
              {plates.map((p) => (
                <Plate key={p.key} plate={p} phone={phone} />
              ))}
            </motion.ul>
          </AnimatePresence>
        </Strip>
      </motion.div>
    </div>
  );
}

/** The plate strip's frame: on desktop, hairline chevrons at both ends and soft edges where plates continue. */
function Strip({
  strip,
  phone,
  step,
  children,
}: {
  strip: HTMLUListElement | null;
  phone: boolean;
  step: (dir: 1 | -1) => void;
  children: ReactNode;
}) {
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = strip;
    if (phone || !el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 };
      setEdges((p) => (p.left === next.left && p.right === next.right ? p : next));
    };
    const ro = new ResizeObserver(measure);
    el.addEventListener('scroll', measure, { passive: true });
    ro.observe(el);
    measure();
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [phone, strip]);

  if (phone) return <div className="shop-strip-frame">{children}</div>;

  const mask = `linear-gradient(to right, ${edges.left ? 'transparent 0, #000 28px' : '#000 0'}, #000 calc(100% - ${
    edges.right ? 120 : 0
  }px), ${edges.right ? 'transparent 100%' : '#000 100%'})`;

  return (
    <div className="shop-strip-frame">
      <div className="shop-strip-mask" style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {children}
      </div>
      <Chevron dir={-1} shown={edges.left} onClick={() => step(-1)} />
      <Chevron dir={1} shown={edges.right} onClick={() => step(1)} />
    </div>
  );
}

function Chevron({ dir, shown, onClick }: { dir: 1 | -1; shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      aria-label={dir > 0 ? 'Next plates' : 'Previous plates'}
      className={`shop-chevron ${dir > 0 ? 'is-next' : 'is-prev'} ${shown ? 'is-shown' : ''}`}
    >
      <svg width="10" height="18" viewBox="0 0 10 18" aria-hidden="true">
        <path
          d={dir > 0 ? 'M1.5 1 L8.5 9 L1.5 17' : 'M8.5 1 L1.5 9 L8.5 17'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </button>
  );
}
