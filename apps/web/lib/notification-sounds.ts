/**
 * Gentle reminder chime using the Web Audio API — no audio file needed.
 * Plays a short two-tone bell sound when a reminder fires in-app.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, gainValue: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Soft two-bell chime — played when a due reminder fires in the app. */
export function playDueChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  playTone(ctx, 880, now,        0.6, 0.18);  // A5 — first bell
  playTone(ctx, 1109, now + 0.3, 0.5, 0.14); // C#6 — second bell
}

/** Shorter single-note ping for pre-due warning. */
export function playPreDuePing() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  playTone(ctx, 660, now, 0.4, 0.12);
}

/** Gentle low thud for overdue nudge. */
export function playOverdueNudge() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  playTone(ctx, 330, now,        0.3, 0.15);
  playTone(ctx, 330, now + 0.35, 0.3, 0.10);
}
