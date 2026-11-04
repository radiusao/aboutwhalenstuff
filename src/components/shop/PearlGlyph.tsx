import { useId } from 'react';
import { C } from '../../world/palette';
import { useArt } from '../useArt';

/** The one solid object in the UI: a 12px pearl with its gradient and a 1px crescent highlight. */
export function PearlGlyph({ className }: { className?: string }) {
  const id = useId();
  const pic = useArt('pearl');
  if (pic) return <img src={pic.url} width={12} height={12} alt="" aria-hidden="true" className={className} style={{ objectFit: 'contain' }} />;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={id} cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" stopColor={C.pearl1} />
          <stop offset="0.55" stopColor={C.pearl2} />
          <stop offset="1" stopColor={C.pearl3} />
        </radialGradient>
      </defs>
      <circle cx="6" cy="6" r="6" fill={`url(#${id})`} />
      <path d="M2.6 6.4 A3.6 3.6 0 0 1 6.2 2.6" fill="none" stroke={C.pearl1} strokeWidth="1" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
