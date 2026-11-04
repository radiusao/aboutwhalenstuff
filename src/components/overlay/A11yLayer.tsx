/**
 * Accessibility mirror (§7.8): a visually hidden list of real buttons for every creature,
 * the whale while it passes, today's bottle while it is out and the Guardian's pearl.
 * Focusing a creature asks the engine for its focus ring and callout; Enter or a click is
 * the same as touching it on the canvas.
 *
 * The bottle button calls `onBottle`, which must start the same flow as a canvas tap
 * (Sanctuary's 'bottleTap' handler: pick the note, then engine.openBottle()). Without it
 * the bottle is left out of the list rather than shipped as a dead control.
 */
import { useState } from 'react';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useEngine, useEngineEvent } from '../../world/EngineContext';
import { commonName } from '../../data/initialData';

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function A11yLayer({ onBottle }: { onBottle?: () => void }) {
  const engine = useEngine();
  const { state } = useSanctuary();
  const [whale, setWhale] = useState(false);
  const [bottle, setBottle] = useState(false);
  const [pearl, setPearl] = useState(false);

  useEngineEvent('whale', (e) => setWhale(e.phase !== 'gone'));
  useEngineEvent('whaleTap', () => setWhale(false));
  useEngineEvent('bottle', (e) => setBottle(e.state === 'arriving' || e.state === 'waiting'));
  useEngineEvent('guardianPearl', (e) => setPearl(e.phase !== 'collected'));

  const creatures = state.creatures.filter((c) => c.type === 'jellyfish' || c.type === 'seahorse');

  return (
    <ul className="sr-only-list pointer-events-auto m-0 list-none p-0" aria-label="Your sea">
      {creatures.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onFocus={() => engine.focusCreature(c.id)}
            onBlur={() => engine.focusCreature(null)}
            onClick={() => engine.feed(c.id)}
          >
            {`${c.name}, ${lowerFirst(commonName(c.type, c.colorVariant))}. Touch.`}
          </button>
        </li>
      ))}
      {whale && (
        <li>
          <button type="button" onClick={() => engine.tapWhale()}>
            The Guardian, passing. Touch.
          </button>
        </li>
      )}
      {bottle && onBottle && (
        <li>
          <button type="button" onClick={onBottle}>
            A bottle, for you. Open.
          </button>
        </li>
      )}
      {pearl && (
        <li>
          <button type="button" onClick={() => engine.tapGuardianPearl()}>
            A pearl from the Guardian. Collect.
          </button>
        </li>
      )}
    </ul>
  );
}
