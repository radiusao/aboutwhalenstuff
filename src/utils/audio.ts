// Placeholder for the ambient track and chime SFX (Web Audio API).

let muted = true;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
}
