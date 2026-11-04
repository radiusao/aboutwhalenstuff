import type { Creature, SanctuaryState } from '../types/sanctuary';

/** Happiness lost per hour. Happiness bottoms out at 0; nothing ever dies. */
export const HAPPINESS_DECAY_PER_HOUR = 5;
/** Pearls per hour from one creature at 100 happiness; scales linearly with happiness. */
export const PEARLS_PER_HOUR_AT_FULL_HAPPINESS = 10;
/** Pearls awarded each time a creature is fed. */
export const FEED_BONUS_PEARLS = 5;
/** Offline earnings stop accruing after this long away, so a long break isn't a jackpot. */
export const MAX_IDLE_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;

export function clampHappiness(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Pearls one creature earns over `hours` while its happiness decays from `startHappiness`.
 * This is the exact area under the linear decay curve, so ticking once per minute or
 * once after a day away gives the same total.
 */
export function pearlsEarnedWhileDecaying(startHappiness: number, hours: number): number {
  const h0 = clampHappiness(startHappiness);
  const decayingHours = Math.min(hours, h0 / HAPPINESS_DECAY_PER_HOUR);
  const happinessHours = decayingHours * (h0 - (HAPPINESS_DECAY_PER_HOUR * decayingHours) / 2);
  return (happinessHours / 100) * PEARLS_PER_HOUR_AT_FULL_HAPPINESS;
}

/**
 * Advances the sanctuary from `state.lastVisited` to `now`: decays happiness and adds
 * passive pearls. Used both on load (offline progress) and by the live tick.
 */
export function advanceSanctuary(
  state: SanctuaryState,
  now: number,
): { state: SanctuaryState; pearlsEarned: number; elapsedMs: number } {
  const elapsedMs = Math.max(0, now - state.lastVisited);
  const hours = Math.min(elapsedMs / MS_PER_HOUR, MAX_IDLE_HOURS);

  let pearlsEarned = 0;
  const creatures: Creature[] = state.creatures.map((creature) => {
    pearlsEarned += pearlsEarnedWhileDecaying(creature.happiness, hours);
    return {
      ...creature,
      happiness: clampHappiness(creature.happiness - HAPPINESS_DECAY_PER_HOUR * hours),
    };
  });

  return {
    state: { ...state, creatures, pearls: state.pearls + pearlsEarned, lastVisited: now },
    pearlsEarned,
    elapsedMs,
  };
}
