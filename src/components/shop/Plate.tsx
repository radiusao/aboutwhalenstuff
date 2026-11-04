import { useEffect, useRef, useState } from 'react';
import { useAnimate } from 'framer-motion';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useEngine } from '../../world/EngineContext';
import { useUiState } from '../uiState';
import { RIBBON_JELLY } from '../../data/initialData';
import { gift } from '../../config/gift';
import { PearlGlyph } from './PearlGlyph';
import { settledCaption, type PlateData } from './catalog';
import { SPECIMEN_SIZE, SpecimenStage } from './stage';

const EASE_ENTER = [0.16, 1, 0.3, 1] as const;
const EASE_EXIT = [0.7, 0, 0.84, 0] as const;

type Status =
  | { kind: 'buy'; cost: number; action: 'Adopt' | 'Place' }
  | { kind: 'short'; cost: number; more: number }
  | { kind: 'full'; cost: number }
  | { kind: 'owned' }
  | { kind: 'gift' };

function useStatus(plate: PlateData): Status {
  const { pearls, state, isAtCap } = useSanctuary();
  if (plate.tab === 'seabed') {
    if (state.unlockedDecorations.includes(plate.id)) return { kind: 'owned' };
    if (pearls >= plate.cost) return { kind: 'buy', cost: plate.cost, action: 'Place' };
    return { kind: 'short', cost: plate.cost, more: plate.cost - pearls };
  }
  if (plate.cost === null) {
    const has = state.creatures.some((c) => c.colorVariant === RIBBON_JELLY.colorVariant);
    return has ? { kind: 'owned' } : { kind: 'gift' };
  }
  if (isAtCap(plate.type)) return { kind: 'full', cost: plate.cost };
  if (pearls >= plate.cost) return { kind: 'buy', cost: plate.cost, action: 'Adopt' };
  return { kind: 'short', cost: plate.cost, more: plate.cost - pearls };
}

/** One specimen plate: live specimen, pin, names, blurb, and the price with its action. */
export function Plate({ plate, phone }: { plate: PlateData; phone: boolean }) {
  const engine = useEngine();
  const ui = useUiState();
  const { adoptCreature, buyDecoration } = useSanctuary();
  const status = useStatus(plate);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<SpecimenStage | null>(null);
  const busy = useRef(0);
  const [liftScope, animate] = useAnimate<HTMLDivElement>();
  // While a bought specimen lifts out it keeps its colour, even if the plate is now "not yet".
  const [leaving, setLeaving] = useState(false);

  const isRibbon = plate.tab === 'life' && plate.cost === null;
  // The Ribbon Jelly plate is always a hairline ghost: it is never for sale.
  const outline = (status.kind === 'short' && !leaving) || isRibbon;

  useEffect(() => {
    const stage = new SpecimenStage(canvasRef.current!, plate.specimen);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, [plate.specimen]);

  useEffect(() => {
    stageRef.current?.setOutline(outline);
  }, [outline]);

  const act = () => {
    const now = performance.now();
    if (status.kind !== 'buy' || now < busy.current) return;
    busy.current = now + 600;
    if (plate.tab === 'seabed') {
      if (buyDecoration(plate.id)) ui.caption(settledCaption[plate.id]);
      return;
    }
    if (plate.adoptIndex === null) return;
    const from = stageRef.current?.center();
    const creature = adoptCreature(plate.adoptIndex);
    if (!creature) return;
    if (from) engine.spawnHint(creature.id, from);
    ui.caption(`Welcome, ${creature.name}.`);
    // The specimen lifts out of its plate as the creature leaves it for the sea. The plate stays
    // empty while the new one rises away behind the scrim, then another specimen settles in.
    setLeaving(true);
    window.setTimeout(() => setLeaving(false), 700);
    void animate(
      liftScope.current,
      { opacity: [1, 0, 0, 1], y: [0, -8, 8, 0] },
      { duration: 3.2, times: [0, 0.11, 0.78, 1], ease: [EASE_EXIT, 'linear', EASE_ENTER] },
    );
  };

  const latin =
    isRibbon && status.kind === 'owned' && gift.ribbonEpithet ? `${plate.latin} ${gift.ribbonEpithet}` : plate.latin;

  return (
    <li
      className="shop-plate flex flex-col"
      data-plate={plate.key}
      tabIndex={-1}
      aria-label={plate.name}
      style={{ width: phone ? '72vw' : 232, padding: phone ? '0 20px' : '0 24px' }}
    >
      <div ref={liftScope} className="shop-specimen-box">
        <canvas
          ref={canvasRef}
          className="shop-specimen block"
          width={SPECIMEN_SIZE}
          height={SPECIMEN_SIZE}
          aria-hidden="true"
        />
      </div>
      <span className="shop-pin" aria-hidden="true" />
      <h3 className="m-0 font-jost font-normal leading-[1.3]" style={{ fontSize: phone ? 16 : 17 }}>
        {plate.name}
      </h3>
      <p className="shop-ink-70 m-0 font-jost text-[13px] font-normal italic leading-[1.4]">{latin}</p>
      <p className="shop-ink-70 shop-blurb m-0 mt-2 font-jost text-[15px] font-light leading-[1.4]">{plate.blurb}</p>
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        <PlateLeft status={status} />
        <PlateRight status={status} onAct={act} name={plate.name} />
      </div>
    </li>
  );
}

function PlateLeft({ status }: { status: Status }) {
  if (status.kind === 'owned') return <span className="shop-ink-55 font-jost text-[13px] font-normal">In your sea</span>;
  if (status.kind === 'gift') return <span />;
  return (
    <span className="flex items-center gap-[7px]">
      <PearlGlyph className="shrink-0" />
      <span className="font-jost text-[14px] font-normal tracking-[0.02em] text-gold tabular-nums">
        <span className="sr-only-list">Price </span>
        {status.cost}
      </span>
    </span>
  );
}

function PlateRight({ status, onAct, name }: { status: Status; onAct: () => void; name: string }) {
  if (status.kind === 'buy') {
    return (
      <button
        type="button"
        onClick={onAct}
        aria-label={`${status.action} the ${name.toLowerCase()}`}
        className="-mr-3 flex min-h-11 min-w-11 items-center justify-end px-3 font-jost text-[15px] font-normal"
      >
        <span className="text-action">{status.action}</span>
      </button>
    );
  }
  const text =
    status.kind === 'short'
      ? `${status.more} more ${status.more === 1 ? 'pearl' : 'pearls'}`
      : status.kind === 'full'
        ? 'No room just now'
        : null;
  if (!text) return null;
  return <span className="shop-ink-55 text-right font-jost text-[13px] font-normal">{text}</span>;
}
