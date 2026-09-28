"use client";

/**
 * Sound and haptic alerts for incoming notifications (Issue #886).
 *
 * # Why the chime is synthesised rather than an audio file
 *
 * A short tone from the Web Audio API costs no network request, no asset to
 * cache in the service worker, and no decode on first play — which matters
 * because the first alert is usually the one that arrives while the user is
 * looking at another tab. The trade-off is that the sound cannot be art
 * directed; for a two-note notification chime that is not much of a loss.
 *
 * # Autoplay
 *
 * Browsers block audio until the page has been interacted with. That is fine
 * here: a user who has never touched the page is not waiting on a chime, and
 * the vibration and the badge still fire. `playChime` resolves either way and
 * never throws, so a blocked sound cannot break the notification path.
 */

/** Two-note chime, in Hz. A rising interval reads as "something arrived". */
const NOTES = [880, 1174.66];
const NOTE_MS = 90;
const GAIN = 0.07;

/** Short double pulse — long enough to feel, short enough not to annoy. */
export const VIBRATION_PATTERN = [40, 60, 40];

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  // One context for the lifetime of the page. Browsers cap how many a document
  // may create, and a leaked context per notification would hit that cap on a
  // busy evening.
  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }

  return audioContext;
}

/** Play the notification chime. Resolves even when audio is unavailable. */
export async function playChime(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Contexts start suspended until a user gesture; resuming is a no-op once
    // the page has been interacted with.
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;

    NOTES.forEach((frequency, i) => {
      const start = ctx.currentTime + (i * NOTE_MS) / 1000;
      const end = start + NOTE_MS / 1000;

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);

      // Ramped rather than switched: an abrupt gain change produces an audible
      // click at the note boundary.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(GAIN, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(end);
    });
  } catch {
    // A blocked or closed context must not propagate into the caller.
  }
}

/**
 * Buzz the device.
 *
 * `navigator.vibrate` is absent on desktop and on iOS Safari, and is ignored
 * outright by browsers when the page is not visible — so this is a best-effort
 * addition to the chime, never a replacement for it.
 */
export function vibrate(pattern: number[] = VIBRATION_PATTERN): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }

  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** Fire both alerts. Muting is the caller's decision, not this module's. */
export async function alertUser(): Promise<void> {
  vibrate();
  await playChime();
}
