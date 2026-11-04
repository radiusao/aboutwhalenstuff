import type { BottleMessage } from '../types/sanctuary';

/**
 * The notes that wash in, one a day, in random order until all have been read; then they start over.
 *
 * They are read from `notes.txt` beside index.html, so they can be changed without rebuilding:
 * one note per paragraph, a blank line between notes, lines starting with # ignored. A note's id
 * is its position (msg-1, msg-2, ...), so new notes go at the bottom to keep "already read" right.
 * If the file is missing (for example when opened straight from disk), the notes below are used.
 */
const BUILT_IN = [
  'You make every ordinary day feel like a little adventure.',
  'Date idea: a late-night walk and your favorite snack, my treat.',
  'Breathe in. You are doing better than you think.',
  'This whole ocean started as your idea. Thank you for dreaming it up.',
  'Reminder: drink some water, stretch, and know that someone is thinking about you.',
  'Date idea: build a blanket fort and watch a movie about the sea.',
  'If you were a sea creature you would definitely be the one that glows.',
];

const NOTES_URL = 'notes.txt';
/** A slow connection gets the built-in notes rather than a blank sea. */
const NOTES_DEADLINE_MS = 4000;

function toMessages(notes: string[]): BottleMessage[] {
  return notes.map((content, i) => ({ id: `msg-${i + 1}`, content, date: '', readStatus: false }));
}

export function parseNotes(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .split(/\n\s*\n/)
    .map((note) => note.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

export let bottleMessages: BottleMessage[] = toMessages(BUILT_IN);

/** Swaps in notes.txt when it is there. Never throws. */
export async function loadNotes(): Promise<void> {
  if (location.protocol === 'file:') return;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), NOTES_DEADLINE_MS);
  try {
    const res = await fetch(NOTES_URL, { cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok || /html/i.test(res.headers.get('content-type') ?? '')) return;
    const notes = parseNotes(await res.text());
    if (notes.length) bottleMessages = toMessages(notes);
  } catch {
    // Keep the built-in notes.
  } finally {
    window.clearTimeout(timer);
  }
}
