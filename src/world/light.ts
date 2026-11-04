/**
 * Light helpers shared by the scene, creatures and UI.
 * Rule: things light up fast and fade slowly. Every flash uses envelope().
 */

/** Flash envelope: 80ms linear attack, then exponential decay (tau 0.9s). t in seconds since trigger. */
export function envelope(t: number): number {
  if (t < 0) return 0;
  if (t < 0.08) return t / 0.08;
  return Math.exp(-(t - 0.08) / 0.9);
}

/**
 * Candle-catch curve for night lanterns switching on: 0.4, 0.1, 0.8, 0.5, 1.0 over 500ms,
 * then holds at 1. t in seconds since this lantern's turn came.
 */
export function candle(t: number): number {
  if (t <= 0) return 0;
  const keys: [number, number][] = [
    [0, 0],
    [0.08, 0.4],
    [0.18, 0.1],
    [0.3, 0.8],
    [0.4, 0.5],
    [0.5, 1],
  ];
  if (t >= 0.5) return 1;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Pre-rendered radial glow sprite: a bright core falling off to body and halo.
 * Never create gradients per frame; draw this sprite scaled instead.
 */
export function glowSprite(color: string, size: 64 | 128 = 64): HTMLCanvasElement {
  const key = `${color}|${size}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, hexA(color, 0.9));
  grad.addColorStop(0.12, hexA(color, 0.55));
  grad.addColorStop(0.35, hexA(color, 0.2));
  grad.addColorStop(0.65, hexA(color, 0.06));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
}

/**
 * Draws a glow sprite additively. `radius` is the halo radius in CSS px; `alpha` 0..1.
 * Inside the world, call WorldFrame.glow() instead so the per-frame glow budget holds.
 */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0.003 || radius <= 0) return;
  const sprite = glowSprite(color, radius > 40 ? 128 : 64);
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevA;
}

function hexA(color: string, a: number): string {
  const hex = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : color;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
