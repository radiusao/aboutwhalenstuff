import type { SanctuaryState } from '../types/sanctuary';
import { createInitialState } from '../data/initialData';

const STORAGE_KEY = 'drift-and-discover:sanctuary:v1';

/**
 * Turns a saved value into a sanctuary, filling fields an older save lacks from a fresh one.
 * Null when it isn't a sanctuary at all.
 */
export function parseSanctuary(saved: unknown): SanctuaryState | null {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const state: SanctuaryState = { ...createInitialState(), ...(saved as Partial<SanctuaryState>) };
  const usable =
    typeof state.pearls === 'number' &&
    Number.isFinite(state.pearls) &&
    typeof state.lastVisited === 'number' &&
    Number.isFinite(state.lastVisited) &&
    Array.isArray(state.creatures) &&
    Array.isArray(state.unlockedDecorations) &&
    Array.isArray(state.readMessageIds);
  return usable ? state : null;
}

/**
 * Returns the saved sanctuary, or null when nothing is saved or storage is unavailable.
 * Missing fields (from an older save) are filled from a fresh sanctuary.
 */
export function loadSanctuary(): SanctuaryState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseSanctuary(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSanctuary(state: SanctuaryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the sanctuary still works, it just won't remember.
  }
}

export function clearSanctuary(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
