/** The three kinds of creature that can live in the sanctuary. */
export type CreatureType = 'whale' | 'jellyfish' | 'seahorse';

/** Ambient lighting presets that shift the ocean gradient. */
export type LightingMode = 'day' | 'sunset' | 'midnight';

/** A point in the ocean, as a percentage (0-100) of the canvas width and height. */
export interface Position {
  x: number;
  y: number;
}

export interface Creature {
  id: string;
  type: CreatureType;
  name: string;
  position: Position;
  /** 0 (glum) to 100 (blissful). Nothing ever dies; low happiness just means less glow. */
  happiness: number;
  /** Key of a color variant, e.g. 'cyan', 'coral', 'gold'. */
  colorVariant: string;
  /** Epoch milliseconds of the last feeding, used for idle progression while the app is closed. */
  lastFed: number;
  /** Epoch milliseconds the creature joined the sea. Missing on saves from before v2. */
  adoptedAt?: number;
}

export interface SanctuaryState {
  /** Currency earned from happy creatures, whale visits and cleaning. */
  pearls: number;
  creatures: Creature[];
  /** IDs of decorations bought in the shop. */
  unlockedDecorations: string[];
  activeLighting: LightingMode;
  /** Epoch milliseconds of the last session, used to award idle pearls on return. */
  lastVisited: number;
  /** IDs of bottle messages already opened, in the order they were read. */
  readMessageIds: string[];
  /** Local day (YYYY-MM-DD) the last bottle was opened; one bottle washes in per day. */
  lastBottleDay: string | null;
  /** Local day (YYYY-MM-DD) each note was first opened, by message id. */
  readMessageDates?: Record<string, string>;
  /** Local day the seahorse pair last did their morning greeting. */
  lastGreetingDay?: string | null;
}

export interface BottleMessage {
  id: string;
  content: string;
  /** ISO date (YYYY-MM-DD) the message washed ashore, or when it is scheduled to. */
  date: string;
  readStatus: boolean;
}

/** A tank decoration that can be bought in the shop. */
export interface Decoration {
  id: string;
  name: string;
  /** Latin or descriptive second line for the shop plate. */
  latin: string;
  /** One short line for the shop plate. */
  blurb: string;
  /** Price in pearls. */
  cost: number;
}

/** What the sanctuary earned while the app was closed, for a "welcome back" moment. */
export interface IdleReport {
  /** Milliseconds since the last visit. */
  elapsedMs: number;
  pearlsEarned: number;
}

/** A creature that can be adopted in the shop. */
export interface AdoptableCreature {
  type: Exclude<CreatureType, 'whale'>;
  colorVariant: string;
  /** Common name shown in the shop, e.g. "Moon jelly". */
  label: string;
  /** Latin binomial shown in italics on the shop plate. */
  latin: string;
  /** One short line for the shop plate. */
  blurb: string;
  cost: number;
}
