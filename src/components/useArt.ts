import { useSyncExternalStore } from 'react';
import { art, artVersion, onArt, type ArtImage, type ArtSlot } from '../world/art';

/** Her picture for a slot (re-renders when it arrives), or null to keep the drawn one. */
export function useArt(slot: ArtSlot): ArtImage | null {
  useSyncExternalStore(onArt, artVersion, artVersion);
  return art(slot);
}
