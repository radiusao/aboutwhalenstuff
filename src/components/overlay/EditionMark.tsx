/**
 * Edition mark (§9.6): a quoted line in fine-pen handwriting, per Radius 2026-10-14,
 * lower-right on the seabed, at 55% of inkDeep (40% fell under 4.5:1).
 */
import { useUiState } from '../uiState';

export function EditionMark() {
  // The overlay sits above the shop (so captions stay crisp); the mark would land on the price row.
  const { panel } = useUiState();
  return (
    <p
      aria-hidden={panel === 'shop'}
      style={{ opacity: panel === 'shop' ? 0 : 1, transition: 'opacity 300ms' }}
      className="pointer-events-none absolute right-[calc(var(--sar)+20px)] bottom-[calc(var(--sab)+18px)] m-0 origin-bottom-right -rotate-[1.5deg] font-hand text-[15px] leading-[1.6] tracking-[0.01em] whitespace-nowrap text-(--ink-deep)/55 sm:right-[max(48px,calc(var(--sar)+20px))] sm:bottom-[calc(var(--sab)+40px)]"
    >
      “…about whale, jelly fish, and ocean”
    </p>
  );
}
