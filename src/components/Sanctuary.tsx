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

/**
 * Tallest height the screen really offers, in CSS px. A web app opened from the iPhone Home
 * Screen can lay the page out shorter than the screen it is given, which left an empty band
 * under the sea; the canvas takes the largest height any of these report, and anything past
 * the real screen edge is simply not shown.
 */
function seaHeight(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const lvh = probe.getBoundingClientRect().height;
  probe.remove();
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  // A Home Screen app owns the whole screen height; in a browser tab the toolbars take part of it.
  const portrait = innerHeight >= innerWidth;
  const screenH = standalone ? (portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)) : 0;
  return Math.max(innerHeight, document.documentElement.clientHeight, window.visualViewport?.height ?? 0, lvh, screenH);
}

function SeaCanvas() {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  const [diag, setDiag] = useState('');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fit = () => {
      canvas.style.height = `${Math.round(seaHeight())}px`;
      if (new URLSearchParams(location.search).has('diag')) setDiag(screenReport(canvas));
    };
    fit();
    engine.mount(canvas);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    // Testing hook: /?debug exposes the engine (summonWhale, summonBottle, ...).
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __engine: Engine }).__engine = engine;
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      engine.destroy();
    };
  }, [engine]);

  return (
    <>
      <canvas ref={ref} className="fixed top-0 left-0 block h-full w-full" style={{ touchAction: 'none' }} aria-hidden="true" />
      {diag && (
        <pre className="pointer-events-none fixed top-[calc(var(--sat)+60px)] left-3 z-50 m-0 bg-black/60 p-2 font-mono text-[11px] leading-snug text-white">
          {diag}
        </pre>
      )}
    </>
  );
}

/** `?diag`: what the phone reports about its screen, for checking the layout on a real device. */
function screenReport(canvas: HTMLCanvasElement): string {
  const safe = getComputedStyle(document.documentElement);
  const r = canvas.getBoundingClientRect();
  return [
    `inner ${innerWidth} x ${innerHeight}`,
    `client ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}`,
    `visual ${Math.round(window.visualViewport?.width ?? 0)} x ${Math.round(window.visualViewport?.height ?? 0)}`,
    `screen ${screen.width} x ${screen.height}  dpr ${devicePixelRatio}`,
    `canvas top ${Math.round(r.top)} h ${Math.round(r.height)}`,
    `safe top ${safe.getPropertyValue('--sat')} bottom ${safe.getPropertyValue('--sab')}`,
    `standalone ${(navigator as unknown as { standalone?: boolean }).standalone ?? matchMedia('(display-mode: standalone)').matches}`,
  ].join('\n');
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
