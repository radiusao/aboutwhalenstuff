import type { AdoptableCreature, Decoration, SanctuaryState } from '../types/sanctuary';

/**
 * A brand-new sanctuary: one moon jelly and the seahorse pair, plus a few pearls to start.
 * The pair is the heart of the tank (they greet each other every morning).
 */
export function createInitialState(now: number = Date.now()): SanctuaryState {
  return {
    pearls: 30,
    creatures: [
      {
        id: 'jelly-1',
        type: 'jellyfish',
        name: 'Luma',
        position: { x: 58, y: 40 },
        happiness: 70,
        colorVariant: 'cyan',
        lastFed: now,
        adoptedAt: now,
      },
      {
        id: 'seahorse-1',
        type: 'seahorse',
        name: 'Pip',
        position: { x: 30, y: 78 },
        happiness: 70,
        colorVariant: 'coral',
        lastFed: now,
        adoptedAt: now,
      },
      {
        id: 'seahorse-2',
        type: 'seahorse',
        name: 'Mochi',
        position: { x: 44, y: 80 },
        happiness: 70,
        colorVariant: 'gold',
        lastFed: now,
        adoptedAt: now,
      },
    ],
    unlockedDecorations: [],
    activeLighting: 'midnight',
    lastVisited: now,
    readMessageIds: [],
    lastBottleDay: null,
    readMessageDates: {},
    lastGreetingDay: null,
  };
}

/** Most creatures of each kind the sea holds at once. */
export const CREATURE_CAPS = { jellyfish: 8, seahorse: 4 } as const;

/** Everything the shop sells under "Seabed". Prices are in pearls. */
export const decorations: Decoration[] = [
  {
    id: 'kelp-forest',
    name: 'Swaying kelp',
    latin: 'Macrocystis pyrifera',
    blurb: 'Tall stalks with little lanterns at night.',
    cost: 25,
  },
  {
    id: 'glowing-coral',
    name: 'Sea fan',
    latin: 'Gorgonia ventalina',
    blurb: 'Its polyps glow after dark.',
    cost: 60,
  },
  {
    id: 'treasure-chest',
    name: 'Sunken chest',
    latin: 'Half buried, lid ajar',
    blurb: 'Light leaks from the keyhole at night.',
    cost: 120,
  },
  {
    id: 'ancient-ruins',
    name: 'Ancient ruins',
    latin: 'A drowned colonnade',
    blurb: 'Far off, on the shelf, very old.',
    cost: 250,
  },
];

/** Everything the shop sells under "Life". */
export const adoptables: AdoptableCreature[] = [
  {
    type: 'jellyfish',
    colorVariant: 'cyan',
    label: 'Moon jelly',
    latin: 'Aurelia aurita',
    blurb: 'Lights its rim when you touch it.',
    cost: 30,
  },
  {
    type: 'seahorse',
    colorVariant: 'coral',
    label: 'Coral seahorse',
    latin: 'Hippocampus bargibanti',
    blurb: 'Holds on with its tail. Turns to look at you.',
    cost: 40,
  },
  {
    type: 'jellyfish',
    colorVariant: 'lilac',
    label: 'Dream jelly',
    latin: 'Atolla wyvillei',
    blurb: 'Light chases around its rim like a pinwheel.',
    cost: 45,
  },
  {
    type: 'seahorse',
    colorVariant: 'gold',
    label: 'Golden seahorse',
    latin: 'Hippocampus kuda',
    blurb: 'Spins when it is happy.',
    cost: 70,
  },
  {
    type: 'seahorse',
    colorVariant: 'lilac',
    label: 'Lilac seahorse',
    latin: 'Hippocampus whitei',
    blurb: 'Shy at first. Fins like a hummingbird.',
    cost: 80,
  },
  {
    type: 'jellyfish',
    colorVariant: 'gold',
    label: 'Sunset jelly',
    latin: 'Pelagia noctiluca',
    blurb: 'Sparkles all over when you touch it.',
    cost: 90,
  },
];

/** The Ribbon Jelly is never sold; the whale sometimes leaves one. */
export const RIBBON_JELLY = {
  type: 'jellyfish' as const,
  colorVariant: 'ribbon',
  label: 'Ribbon jelly',
  latin: 'Chrysaora',
  blurb: 'Not for sale. The Guardian decides.',
};

/** Common names by type and variant, for callouts ("Moon jelly · since 2 Oct"). */
export function commonName(type: string, variant: string): string {
  if (type === 'jellyfish' && variant === RIBBON_JELLY.colorVariant) return RIBBON_JELLY.label;
  return adoptables.find((a) => a.type === type && a.colorVariant === variant)?.label ?? type;
}

export const creatureNames = [
  'Nori', 'Bubbles', 'Sunny', 'Wisp', 'Pearl', 'Tide', 'Juniper', 'Marlo', 'Kiki',
  'Sol', 'Ripple', 'Dot', 'Willow', 'Biscuit', 'Moon', 'Fern', 'Clove', 'Indigo',
];
