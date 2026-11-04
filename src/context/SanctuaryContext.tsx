import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { BottleMessage, Creature, CreatureType, IdleReport, LightingMode, SanctuaryState } from '../types/sanctuary';
import { adoptables, CREATURE_CAPS, createInitialState, creatureNames, decorations, RIBBON_JELLY } from '../data/initialData';
import { gift } from '../config/gift';
import { bottleMessages } from '../data/messages';
import { loadSanctuary, saveSanctuary } from '../utils/storage';
import { advanceSanctuary, FEED_BONUS_PEARLS } from '../utils/progression';
import { brisbaneHours, localDay } from '../utils/day';

const LIGHTING_CYCLE: LightingMode[] = ['day', 'sunset', 'midnight'];
/** How often happiness decay and passive pearls are applied while the app is open. */
const TICK_INTERVAL_MS = 5 * 1000;
/** Feeding a creature this happy still makes it spin, but gives no bonus pearls. */
const FULL_HAPPINESS = 95;

type SanctuaryAction =
  | { type: 'TICK'; now: number }
  | { type: 'ADD_PEARLS'; amount: number }
  | { type: 'FEED_CREATURE'; creatureId: string; now: number }
  | { type: 'BUY_DECORATION'; decorationId: string }
  | { type: 'ADOPT_CREATURE'; index: number; now: number; name: string; position: { x: number; y: number } }
  | { type: 'ADD_GIFT_CREATURE'; creature: Creature }
  | { type: 'OPEN_BOTTLE'; messageId: string; day: string }
  | { type: 'MARK_GREETING'; day: string }
  | { type: 'SET_LIGHTING'; lighting: LightingMode };

function reducer(state: SanctuaryState, action: SanctuaryAction): SanctuaryState {
  switch (action.type) {
    case 'TICK':
      return advanceSanctuary(state, action.now).state;

    case 'ADD_PEARLS':
      return { ...state, pearls: Math.max(0, state.pearls + action.amount) };

    case 'FEED_CREATURE': {
      if (!state.creatures.some((c) => c.id === action.creatureId)) return state;
      // Settle decay up to now first so the reset to 100 isn't followed by a stale catch-up.
      const settled = advanceSanctuary(state, action.now).state;
      const creature = settled.creatures.find((c) => c.id === action.creatureId)!;
      const bonus = creature.happiness < FULL_HAPPINESS ? FEED_BONUS_PEARLS : 0;
      return {
        ...settled,
        pearls: settled.pearls + bonus,
        creatures: settled.creatures.map((c) =>
          c.id === action.creatureId ? { ...c, happiness: 100, lastFed: action.now } : c,
        ),
      };
    }

    case 'BUY_DECORATION': {
      const decoration = decorations.find((d) => d.id === action.decorationId);
      if (!decoration || state.unlockedDecorations.includes(decoration.id)) return state;
      if (state.pearls < decoration.cost) return state;
      return {
        ...state,
        pearls: state.pearls - decoration.cost,
        unlockedDecorations: [...state.unlockedDecorations, decoration.id],
      };
    }

    case 'ADOPT_CREATURE': {
      const item = adoptables[action.index];
      if (!item || state.pearls < item.cost || atCap(state, item.type)) return state;
      return {
        ...state,
        pearls: state.pearls - item.cost,
        creatures: [
          ...state.creatures,
          {
            id: `${item.type}-${action.now}`,
            type: item.type,
            name: action.name,
            position: action.position,
            happiness: 100,
            colorVariant: item.colorVariant,
            lastFed: action.now,
            adoptedAt: action.now,
          },
        ],
      };
    }

    case 'ADD_GIFT_CREATURE':
      if (state.creatures.some((c) => c.id === action.creature.id)) return state;
      return { ...state, creatures: [...state.creatures, action.creature] };

    case 'MARK_GREETING':
      return { ...state, lastGreetingDay: action.day };

    case 'OPEN_BOTTLE':
      return {
        ...state,
        lastBottleDay: action.day,
        readMessageDates: { [action.messageId]: action.day, ...state.readMessageDates },
        readMessageIds: state.readMessageIds.includes(action.messageId)
          ? state.readMessageIds
          : [...state.readMessageIds, action.messageId],
      };

    case 'SET_LIGHTING':
      return state.activeLighting === action.lighting ? state : { ...state, activeLighting: action.lighting };
  }
}

function atCap(state: SanctuaryState, type: 'jellyfish' | 'seahorse'): boolean {
  return state.creatures.filter((c) => c.type === type).length >= CREATURE_CAPS[type];
}

/** Time of day on the Brisbane clock: 06-17 day, 17-19:30 sunset, otherwise midnight. */
export function lightingForClock(date: Date = new Date()): LightingMode {
  const h = brisbaneHours(date);
  if (h >= 6 && h < 17) return 'day';
  if (h >= 17 && h < 19.5) return 'sunset';
  return 'midnight';
}

/** Applies everything that happened while she was away to a saved sanctuary. */
function catchUp(saved: SanctuaryState, now: number): { state: SanctuaryState; idleReport: IdleReport } {
  const { state, pearlsEarned, elapsedMs } = advanceSanctuary(saved, now);
  return { state, idleReport: { elapsedMs, pearlsEarned } };
}

interface InitialSanctuary {
  state: SanctuaryState;
  idleReport: IdleReport;
}

/** Loads the saved sanctuary (or a new one) and applies everything that happened while away. */
function initSanctuary(): InitialSanctuary {
  const now = Date.now();
  const saved = loadSanctuary();
  if (!saved) {
    const fresh = { ...createInitialState(now), activeLighting: lightingForClock() };
    return { state: fresh, idleReport: { elapsedMs: 0, pearlsEarned: 0 } };
  }
  const { state, idleReport } = catchUp(saved, now);
  // Each new session opens on the light that matches her clock.
  return {
    state: { ...state, activeLighting: lightingForClock() },
    idleReport,
  };
}

/** A name no creature in the sea has yet, preferring the pet names Radius set in gift.ts. */
function pickName(creatures: Creature[]): string {
  const taken = new Set(creatures.map((c) => c.name));
  const preferred = gift.petNames.filter((n) => !taken.has(n));
  if (preferred.length) return preferred[0];
  const free = creatureNames.filter((n) => !taken.has(n));
  const pool = free.length ? free : creatureNames;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Where a new creature settles: jellyfish drift mid-water, seahorses stay near the seabed. */
function spawnPosition(type: CreatureType): { x: number; y: number } {
  const x = 12 + Math.random() * 76;
  const y = type === 'seahorse' ? 76 + Math.random() * 8 : 18 + Math.random() * 44;
  return { x, y };
}

interface SanctuaryContextValue {
  state: SanctuaryState;
  /** Pearls rounded down for display and price checks; the stored balance keeps fractions. */
  pearls: number;
  /** What was earned while the app was closed, computed on load. */
  idleReport: IdleReport;
  addPearls: (amount: number) => void;
  /** Resets happiness to 100. Returns the bonus pearls given (0 when it was already full). */
  feedCreature: (creatureId: string) => number;
  /** Returns false when the item is unknown, already owned, or too expensive. */
  buyDecoration: (decorationId: string) => boolean;
  /**
   * Adopts the creature at `index` in `adoptables`. Returns the new creature,
   * or null when it is unaffordable or the sea is full of that kind.
   */
  adoptCreature: (index: number) => Creature | null;
  /** True when the sea already holds the most creatures of this kind. */
  isAtCap: (type: 'jellyfish' | 'seahorse') => boolean;
  /** Adds the Guardian's one-time Ribbon Jelly. Returns it, or null if she already has one. */
  receiveRibbonJelly: (position: { x: number; y: number }) => Creature | null;
  /** True when the seahorse pair has not greeted each other yet today. */
  greetingDue: boolean;
  markGreeting: () => void;
  /** Cycles day, sunset, midnight; or jumps to a specific mode when one is given. */
  toggleLighting: (lighting?: LightingMode) => void;
  /** True when today's bottle hasn't been opened yet. */
  bottleAvailable: boolean;
  /** Picks today's note (unread first, at random), marks it read and returns it. */
  openBottle: () => BottleMessage;
}

const SanctuaryContext = createContext<SanctuaryContextValue | null>(null);

export function SanctuaryProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initSanctuary);
  const [state, applyAction] = useReducer(reducer, initial.state);
  const [idleReport] = useState(initial.idleReport);
  const [today, setToday] = useState(localDay);

  const dispatch = useCallback((action: SanctuaryAction) => applyAction(action), []);

  useEffect(() => {
    const tick = () => {
      dispatch({ type: 'TICK', now: Date.now() });
      // The light follows the Brisbane clock on its own.
      applyAction({ type: 'SET_LIGHTING', lighting: lightingForClock() });
      setToday(localDay());
    };
    const id = window.setInterval(tick, TICK_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    saveSanctuary(state);
  }, [state]);

  const addPearls = useCallback((amount: number) => dispatch({ type: 'ADD_PEARLS', amount }), []);

  const feedCreature = useCallback(
    (creatureId: string) => {
      const now = Date.now();
      const settled = advanceSanctuary(state, now).state;
      const creature = settled.creatures.find((c) => c.id === creatureId);
      if (!creature) return 0;
      dispatch({ type: 'FEED_CREATURE', creatureId, now });
      return creature.happiness < FULL_HAPPINESS ? FEED_BONUS_PEARLS : 0;
    },
    [state],
  );

  const buyDecoration = useCallback(
    (decorationId: string) => {
      const decoration = decorations.find((d) => d.id === decorationId);
      const canBuy =
        !!decoration && !state.unlockedDecorations.includes(decorationId) && state.pearls >= decoration.cost;
      if (canBuy) dispatch({ type: 'BUY_DECORATION', decorationId });
      return canBuy;
    },
    [state.pearls, state.unlockedDecorations],
  );

  const isAtCap = useCallback((type: 'jellyfish' | 'seahorse') => atCap(state, type), [state]);

  const adoptCreature = useCallback(
    (index: number): Creature | null => {
      const item = adoptables[index];
      if (!item || state.pearls < item.cost || atCap(state, item.type)) return null;
      const now = Date.now();
      const name = pickName(state.creatures);
      const position = spawnPosition(item.type);
      dispatch({ type: 'ADOPT_CREATURE', index, now, name, position });
      return {
        id: `${item.type}-${now}`,
        type: item.type,
        name,
        position,
        happiness: 100,
        colorVariant: item.colorVariant,
        lastFed: now,
        adoptedAt: now,
      };
    },
    [state],
  );

  const receiveRibbonJelly = useCallback(
    (position: { x: number; y: number }): Creature | null => {
      if (state.creatures.some((c) => c.colorVariant === RIBBON_JELLY.colorVariant)) return null;
      const now = Date.now();
      const creature: Creature = {
        id: `ribbon-${now}`,
        type: 'jellyfish',
        name: pickName(state.creatures),
        position,
        happiness: 100,
        colorVariant: RIBBON_JELLY.colorVariant,
        lastFed: now,
        adoptedAt: now,
      };
      dispatch({ type: 'ADD_GIFT_CREATURE', creature });
      return creature;
    },
    [state.creatures],
  );

  const markGreeting = useCallback(() => dispatch({ type: 'MARK_GREETING', day: today }), [today]);

  const toggleLighting = useCallback(
    (lighting?: LightingMode) => {
      const next =
        lighting ?? LIGHTING_CYCLE[(LIGHTING_CYCLE.indexOf(state.activeLighting) + 1) % LIGHTING_CYCLE.length];
      dispatch({ type: 'SET_LIGHTING', lighting: next });
    },
    [state.activeLighting],
  );

  const openBottle = useCallback(() => {
    const unread = bottleMessages.filter((m) => !state.readMessageIds.includes(m.id));
    // Once every note has been read, start the cycle again from the full list.
    const pool = unread.length ? unread : bottleMessages;
    const message = pool[Math.floor(Math.random() * pool.length)];
    dispatch({ type: 'OPEN_BOTTLE', messageId: message.id, day: today });
    return { ...message, date: today, readStatus: true };
  }, [state.readMessageIds, today]);

  const value = useMemo<SanctuaryContextValue>(
    () => ({
      state,
      pearls: Math.floor(state.pearls),
      idleReport,
      addPearls,
      feedCreature,
      buyDecoration,
      adoptCreature,
      isAtCap,
      receiveRibbonJelly,
      greetingDue: state.lastGreetingDay !== today,
      markGreeting,
      toggleLighting,
      bottleAvailable: bottleMessages.length > 0 && state.lastBottleDay !== today,
      openBottle,
    }),
    [
      state,
      idleReport,
      today,
      addPearls,
      feedCreature,
      buyDecoration,
      adoptCreature,
      isAtCap,
      receiveRibbonJelly,
      markGreeting,
      toggleLighting,
      openBottle,
    ],
  );

  return <SanctuaryContext.Provider value={value}>{children}</SanctuaryContext.Provider>;
}

export function useSanctuary(): SanctuaryContextValue {
  const ctx = useContext(SanctuaryContext);
  if (!ctx) throw new Error('useSanctuary must be used inside SanctuaryProvider');
  return ctx;
}
