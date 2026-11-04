/** Tonight's real moon phase, so the moon through the water matches the sky. */

/** 0 = new moon, 0.5 = full moon. */
export function moonPhase(date: Date = new Date()): number {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const p = (days / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Draws the lit part of the moon disc at (x, y) with radius r. The terminator is drawn
 * with two arcs (the limb and an ellipse whose width follows the phase).
 */
export function drawMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  phase: number,
  color: string,
  alpha: number,
): void {
  const waxing = phase < 0.5;
  // Illuminated fraction, 0 (new) .. 1 (full).
  const k = Math.cos(phase * 2 * Math.PI); // 1 new, -1 full
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  // Limb: the lit half circle.
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
  // Terminator: half ellipse back to the top, rx = |k| * r.
  const rx = Math.abs(k) * r;
  const bulgeOut = k < 0; // past quarter, the lit area bulges past the centre line
  ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, waxing ? !bulgeOut : bulgeOut);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
