/** What the shop shows: one plate per adoptable creature, the Ribbon Jelly, and each decoration. */
import { adoptables, decorations, RIBBON_JELLY } from '../../data/initialData';
import type { DecorationId } from '../../world/scenery';

export type ShopTab = 'life' | 'seabed';

export type SpecimenSpec =
  | { kind: 'jellyfish' | 'seahorse'; variant: string }
  | { kind: 'decoration'; id: DecorationId };

interface PlateBase {
  key: string;
  name: string;
  latin: string;
  blurb: string;
  specimen: SpecimenSpec;
}

export interface CreaturePlate extends PlateBase {
  tab: 'life';
  type: 'jellyfish' | 'seahorse';
  /** Index into `adoptables` (what adoptCreature takes), or null for the Ribbon Jelly. */
  adoptIndex: number | null;
  cost: number | null;
}

export interface DecorationPlate extends PlateBase {
  tab: 'seabed';
  id: DecorationId;
  cost: number;
}

export type PlateData = CreaturePlate | DecorationPlate;

export const lifePlates: CreaturePlate[] = [
  ...adoptables.map(
    (a, i): CreaturePlate => ({
      key: `${a.type}:${a.colorVariant}`,
      tab: 'life',
      type: a.type,
      name: a.label,
      latin: a.latin,
      blurb: a.blurb,
      cost: a.cost,
      adoptIndex: i,
      specimen: { kind: a.type, variant: a.colorVariant },
    }),
  ),
  {
    key: `jellyfish:${RIBBON_JELLY.colorVariant}`,
    tab: 'life',
    type: RIBBON_JELLY.type,
    name: RIBBON_JELLY.label,
    latin: RIBBON_JELLY.latin,
    blurb: RIBBON_JELLY.blurb,
    cost: null,
    adoptIndex: null,
    specimen: { kind: 'jellyfish', variant: RIBBON_JELLY.colorVariant },
  },
];

export const seabedPlates: DecorationPlate[] = decorations.map((d) => ({
  key: `decoration:${d.id}`,
  tab: 'seabed',
  id: d.id as DecorationId,
  name: d.name,
  latin: d.latin,
  blurb: d.blurb,
  cost: d.cost,
  specimen: { kind: 'decoration', id: d.id as DecorationId },
}));

/** The caption once a decoration is placed. Warm, short, no exclamation marks. */
export const settledCaption: Record<DecorationId, string> = {
  'kelp-forest': 'The kelp has settled in.',
  'glowing-coral': 'The sea fan has taken hold.',
  'treasure-chest': 'The chest has sunk into the sand.',
  'ancient-ruins': 'The old ruins are on the far shelf now.',
};
