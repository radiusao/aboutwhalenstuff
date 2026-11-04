/**
 * Personal touches for the gift. Radius fills these in; every field has a fallback,
 * so leave anything you're unsure about as null.
 */
export interface GiftConfig {
  /** Her name, used in "no. 1 of 1, for {herName}". Null shows "for you". */
  herName: string | null;
  /** The initial that signs every note and the edition mark. */
  fromInitial: string;
  /**
   * Radius's traced signature as an SVG path `d` in a 0 0 200 60 box. It draws itself
   * at the bottom of each note. Null falls back to a handwritten "— R.".
   */
  signaturePath: string | null;
  /** Seeds the shape of her sea (e.g. an anniversary as YYYYMMDD) so it never changes. */
  seaSeed: number | null;
  /** 20-30 points (0-1 along the whale's length, 0-1 across its back) for the night constellation. */
  constellation: [number, number][] | null;
  /** Species epithet for the Ribbon Jelly, e.g. "aminae". Null shows "a gift from the Guardian". */
  ribbonEpithet: string | null;
  /** Names to give new creatures first, in order, before the built-in list. */
  petNames: string[];
}

export const gift: GiftConfig = {
  herName: null,
  fromInitial: 'R',
  signaturePath: null,
  seaSeed: null,
  constellation: null,
  ribbonEpithet: null,
  petNames: [],
};
