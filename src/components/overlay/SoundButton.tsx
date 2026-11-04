/**
 * The sound glyph (§7.1): three vertical hairlines that move like audio bars while the music
 * plays and lie flat when it's off. Also keeps the music on the current time of day.
 */
import { useEffect, useState } from 'react';
import type { LightingMode } from '../../types/sanctuary';
import { initMusic, isSoundOn, onSoundChange, setMusicMode, setSound } from '../../utils/audio';

export function SoundButton({ mode }: { mode: LightingMode }) {
  const [on, setOn] = useState(isSoundOn);

  useEffect(() => initMusic(mode), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMusicMode(mode), [mode]);
  useEffect(() => onSoundChange(setOn), []);

  return (
    <button
      type="button"
      className="qf-control qf-sound pointer-events-auto relative -mt-[9px] ml-2 flex h-11 w-11 items-center justify-center sm:-mt-[6.5px]"
      aria-label={on ? 'Turn music off' : 'Turn music on'}
      aria-pressed={on}
      data-on={on || undefined}
      onClick={() => setSound(!on)}
    >
      <span className="qf-focus flex h-[14px] items-end gap-[3px]" aria-hidden="true">
        <span className="qf-bar" />
        <span className="qf-bar" />
        <span className="qf-bar" />
      </span>
    </button>
  );
}
