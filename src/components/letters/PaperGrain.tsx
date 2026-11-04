import { useId, useMemo } from 'react';
import { stream, range } from '../../world/rng';
import { C, mixOK } from '../../world/palette';
import { PAPER_INK } from './paper';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface Props {
  /** Seeds the fibres and the stain, so a note looks the same every time it is reread. */
  seed: string;
  width: number;
  height: number;
  /** Fibre hairlines (12 on a note). */
  fibres?: number;
  /** Corners the stain may bloom in. */
  corners?: Corner[];
}

/** Closed Catmull-Rom spline through points, as cubic beziers. */
function closedSpline(p: [number, number][]): string {
  const n = p.length;
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

const DEFAULT_CORNERS: Corner[] = ['tr', 'bl', 'tl'];
/** The tide line: paper-stain, a shade deeper, so the ring reads darker than the paper and never as a pale blob. */
const TIDE = mixOK(C.paperStain, '#5A3E1E', 0.35);

/**
 * The note's only texture (§7.6): short seeded fibres at 4% (paper fibre, not hairs on the
 * glass) and one dried water stain in a corner, drawn only as its tide line: a faint ring a
 * little darker than the paper, stronger on one side where the water stood longest.
 */
export function PaperGrain({ seed, width, height, fibres = 12, corners = DEFAULT_CORNERS }: Props) {
  const gradId = `stain${useId().replace(/[^\w-]/g, '')}`;
  const art = useMemo(() => {
    const r = stream(`paper:${seed}`);
    const lines: string[] = [];
    for (let i = 0; i < fibres; i++) {
      const x = range(r, 8, width - 8);
      const y = range(r, 8, height - 8);
      const len = range(r, 4, 9);
      const a = range(r, -0.5, 0.5) + (r() < 0.3 ? Math.PI / 2 : 0);
      const bend = range(r, -1, 1);
      const x1 = x + Math.cos(a) * len;
      const y1 = y + Math.sin(a) * len;
      const cx = (x + x1) / 2 - Math.sin(a) * bend;
      const cy = (y + y1) / 2 + Math.cos(a) * bend;
      lines.push(`M${x.toFixed(1)} ${y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`);
    }

    const corner = corners[Math.floor(r() * corners.length)];
    const rad = range(r, 46, 64);
    const sx = corner[1] === 'l' ? range(r, 6, 22) : width - range(r, 6, 22);
    const sy = corner[0] === 't' ? range(r, 10, 26) : height - range(r, 10, 26);
    const n = 22;
    const phase = r() * Math.PI * 2;
    const k1 = range(r, 0.06, 0.1);
    const k2 = range(r, 0.03, 0.05);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const wob = 1 + k1 * Math.sin(2 * t + phase) + k2 * Math.sin(5 * t + phase * 1.7) + range(r, -0.025, 0.025);
      pts.push([sx + Math.cos(t) * rad * wob, sy + Math.sin(t) * rad * wob * 0.86]);
    }
    return { lines, stain: closedSpline(pts), sx, sy, rad };
  }, [seed, width, height, fibres, corners]);

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
      aria-hidden="true"
      style={{ overflow: 'hidden' }}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={art.sx - art.rad}
          y1={art.sy + art.rad}
          x2={art.sx + art.rad}
          y2={art.sy - art.rad}
        >
          <stop offset="0" stopColor={TIDE} stopOpacity="0.15" />
          <stop offset="0.55" stopColor={TIDE} stopOpacity="0.085" />
          <stop offset="1" stopColor={TIDE} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={art.stain} fill="none" stroke={`url(#${gradId})`} strokeWidth="1.3" strokeLinejoin="round" />
      <path d={art.lines.join('')} fill="none" stroke={PAPER_INK} strokeOpacity="0.04" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}
