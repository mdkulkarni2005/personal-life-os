let audioContext: AudioContext | null = null;
let lastPlayAt = 0;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext ?? (window as Window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }
  return audioContext;
}

async function ensureRunning(ctx: AudioContext) {
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }
}

/** Small, modern, non-intrusive cue for assistant/system events. */
export async function playUiCue(kind: "briefing" | "notification" | "share" = "briefing") {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayAt < 180) return;
  lastPlayAt = now;

  const ctx = getAudioContext();
  if (ctx) {
    await ensureRunning(ctx);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const osc = ctx.createOscillator();

    osc.type = kind === "share" ? "triangle" : "sine";
    osc.frequency.value = kind === "notification" ? 784 : kind === "share" ? 622 : 523;
    filter.type = "lowpass";
    filter.frequency.value = 1600;
    gain.gain.value = 0.0001;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.start(t);
    osc.stop(t + 0.24);
    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(kind === "notification" ? [80, 30, 80] : [35]);
  }
}
