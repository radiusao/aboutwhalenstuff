/**
 * Small shared state for the DOM overlay: which panel is open, the open note,
 * captions, the creature callout, and "+5" floaters. Presentation only; saved
 * state lives in SanctuaryContext.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BottleMessage } from '../types/sanctuary';

export type Panel = 'none' | 'shop' | 'letters' | 'note';

export interface OpenNote {
  message: BottleMessage;
  /** Screen point of the bottle the paper unrolls from. */
  anchor: { x: number; y: number };
  /** 'bottle' = today's bottle (engine plays the opening move); 'shelf' = a kept bottle. */
  source: 'bottle' | 'shelf';
}

export interface Caption {
  id: number;
  text: string;
}

export interface Callout {
  /** Creature id. */
  id: string;
  /** Anchor on the creature, CSS px. */
  x: number;
  y: number;
  r: number;
  /** Pet name, e.g. "Luma". */
  name: string;
  /** e.g. "Moon jelly · since 2 Oct". */
  sub: string;
  /** Changes on every show so repeated taps replay the leader line. */
  key: number;
}

export interface Floater {
  id: number;
  text: string;
  x: number;
  y: number;
}

interface UiStateValue {
  panel: Panel;
  openShop: () => void;
  openLetters: () => void;
  closePanel: () => void;
  note: OpenNote | null;
  showNote: (note: OpenNote) => void;
  captions: Caption[];
  /** Shows one caption line lower-left (at most 2 stacked). */
  caption: (text: string) => void;
  callout: Callout | null;
  showCallout: (c: Omit<Callout, 'key'>) => void;
  hideCallout: () => void;
  floaters: Floater[];
  /** "+5" style earn text rising from a screen point. */
  floater: (text: string, x: number, y: number) => void;
}

const UiStateContext = createContext<UiStateValue | null>(null);

const CAPTION_MS = 600 + 3200 + 900;
const FLOATER_MS = 1400;

export function UiStateProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>('none');
  const [note, setNote] = useState<OpenNote | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const nextId = useRef(1);

  const caption = useCallback((text: string) => {
    const id = nextId.current++;
    setCaptions((c) => [...c.slice(-1), { id, text }]);
    window.setTimeout(() => setCaptions((c) => c.filter((x) => x.id !== id)), CAPTION_MS);
  }, []);

  const floater = useCallback((text: string, x: number, y: number) => {
    const id = nextId.current++;
    setFloaters((f) => [...f, { id, text, x, y }]);
    window.setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), FLOATER_MS);
  }, []);

  const value = useMemo<UiStateValue>(
    () => ({
      panel,
      openShop: () => setPanel('shop'),
      openLetters: () => setPanel('letters'),
      closePanel: () => {
        setPanel('none');
        setNote(null);
      },
      note,
      showNote: (n) => {
        setNote(n);
        setPanel('note');
      },
      captions,
      caption,
      callout,
      showCallout: (c) => setCallout({ ...c, key: nextId.current++ }),
      hideCallout: () => setCallout(null),
      floaters,
      floater,
    }),
    [panel, note, captions, caption, callout, floaters, floater],
  );

  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>;
}

export function useUiState(): UiStateValue {
  const ctx = useContext(UiStateContext);
  if (!ctx) throw new Error('useUiState must be used inside UiStateProvider');
  return ctx;
}
