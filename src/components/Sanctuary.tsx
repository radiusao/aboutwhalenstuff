/**
 * The whole app: one full-viewport canvas (the sea) with the DOM overlay set on top.
 * This file only wires saved state and engine events together.
 */
import { useEffect, useRef, useState } from 'react';
import { createEngine } from '../world/engine';
import { EngineProvider, useEngine, useEngineEvent } from '../world/EngineContext';
import type { Engine } from '../world/types';
import { useSanctuary } from '../context/SanctuaryContext';
import { UiStateProvider, useUiState } from './uiState';
import { Overlay } from './overlay';
import { Shop } from './shop';
import { Letters, NotePaper } from './letters';
import { commonName, RIBBON_JELLY } from '../data/initialData';
import { bottleMessages } from '../data/messages';
import { gift } from '../config/gift';
import type { BottleMessage } from '../types/sanctuary';

const GUARDIAN_PEARL = 25;

export default function Sanctuary() {
  const [engine] = useState<Engine>(() => createEngine());

  return (
    <EngineProvider engine={engine}>
      <UiStateProvider>
        <Inner />
      </UiStateProvider>
    </EngineProvider>
  );
}

function Inner() {
  const engine = useEngine();
  const { openBottle } = useSanctuary();
  const pendingNote = useRef<BottleMessage | null>(null);

  /** Today's bottle was tapped (canvas or a11y): pick the note, then play the opening move. */
  const openTodaysBottle = () => {
    if (pendingNote.current) return;
    pendingNote.current = openBottle();
    engine.openBottle();
  };

  return (
    <div className="fixed inset-0 overflow-hidden select-none">
      <SeaCanvas />
      <Wiring pendingNote={pendingNote} openTodaysBottle={openTodaysBottle} />
      <Overlay onBottle={openTodaysBottle} />
      <Shop />
      <NotePaper />
      <Letters />
    </div>
  );
}

function SeaCanvas() {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.mount(canvas);
    // Testing hook: /?debug exposes the engine (summonWhale, summonBottle, ...).
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __engine: Engine }).__engine = engine;
    return () => engine.destroy();
  }, [engine]);

  return <canvas ref={ref} className="absolute inset-0 block h-full w-full" style={{ touchAction: 'none' }} aria-hidden="true" />;
}

function sinceLabel(adoptedAt: number | undefined): string {
  if (!adoptedAt) return '';
  const d = new Date(adoptedAt);
  return ` · since ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** Keeps the engine in step with saved state and turns engine events into UI and saves. */
function Wiring({
  pendingNote,
  openTodaysBottle,
}: {
  pendingNote: React.RefObject<BottleMessage | null>;
  openTodaysBottle: () => void;
}) {
  const engine = useEngine();
  const ui = useUiState();
  const {
    state,
    feedCreature,
    addPearls,
    bottleAvailable,
    greetingDue,
    markGreeting,
    receiveRibbonJelly,
  } = useSanctuary();
  const firstMode = useRef(true);

  // Saved state -> scene.
  useEffect(() => {
    engine.sync({
      creatures: state.creatures
        .filter((c) => c.type === 'jellyfish' || c.type === 'seahorse')
        .map((c) => ({
          id: c.id,
          type: c.type as 'jellyfish' | 'seahorse',
          variant: c.colorVariant,
          name: c.name,
          position: c.position,
          happiness: c.happiness,
        })),
      decorations: state.unlockedDecorations,
      shelf: state.readMessageIds,
      bottleAvailable,
      greetingDue,
      hasRibbon: state.creatures.some((c) => c.colorVariant === RIBBON_JELLY.colorVariant),
    });
  }, [engine, state.creatures, state.unlockedDecorations, state.readMessageIds, bottleAvailable, greetingDue]);

  useEffect(() => {
    engine.setMode(state.activeLighting, { instant: firstMode.current });
    firstMode.current = false;
  }, [engine, state.activeLighting]);

  const showCalloutFor = (id: string, x: number, y: number, r: number) => {
    const c = state.creatures.find((cr) => cr.id === id);
    if (!c) return;
    ui.showCallout({ id, x, y, r, name: c.name, sub: `${commonName(c.type, c.colorVariant)}${sinceLabel(c.adoptedAt)}` });
  };

  useEngineEvent('creatureTap', (e) => {
    const bonus = feedCreature(e.id);
    if (bonus > 0) ui.floater(`+${bonus}`, e.x, e.y - e.r);
    showCalloutFor(e.id, e.x, e.y, e.r);
  });

  useEngineEvent('focus', (e) => {
    if (e.id) showCalloutFor(e.id, e.x, e.y, e.r);
    else ui.hideCallout();
  });

  useEngineEvent('whale', (e) => {
    if (e.phase === 'arriving') ui.caption('The Guardian is passing.');
  });

  useEngineEvent('guardianPearl', (e) => {
    if (e.phase === 'released') ui.caption('The Guardian left you a pearl.');
    if (e.phase === 'collected') {
      addPearls(GUARDIAN_PEARL);
      ui.floater(`+${GUARDIAN_PEARL}`, e.x, e.y);
    }
  });

  useEngineEvent('ribbonReleased', (e) => {
    const position = { x: (e.x / window.innerWidth) * 100, y: (e.y / window.innerHeight) * 100 };
    const ribbon = receiveRibbonJelly(position);
    if (!ribbon) return;
    engine.spawnHint(ribbon.id, { x: e.x, y: e.y });
    ui.caption('The Guardian left something new.');
    if (gift.ribbonEpithet) ui.caption("It's named for you.");
  });

  useEngineEvent('bottleTap', openTodaysBottle);

  useEngineEvent('bottle', (e) => {
    if (e.state === 'open' && pendingNote.current) {
      ui.showNote({ message: pendingNote.current, anchor: { x: e.x, y: e.y }, source: 'bottle' });
      pendingNote.current = null;
    }
  });

  useEngineEvent('shelfBottleTap', (e) => {
    const message = bottleMessages.find((m) => m.id === e.messageId);
    if (!message) return;
    ui.showNote({
      message: { ...message, date: state.readMessageDates?.[message.id] ?? '', readStatus: true },
      anchor: { x: e.x, y: e.y },
      source: 'shelf',
    });
  });

  useEngineEvent('greeting', (e) => {
    if (e.phase === 'start') {
      markGreeting();
      ui.caption('They do this every morning.');
    }
  });

  return null;
}
