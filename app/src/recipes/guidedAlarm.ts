import alarmSrc from './alarm.wav?url';

// The sound a finished step makes (a port of js/catalogue/guided-alarm.js).
//
// ⚠️ A FILE, NOT A SYNTHESISED TONE, AND NOT A data: URI. A `data:` URI is refused by the page's CSP (no media-src), so the
// audio would never load — and would fail on the phone while working in whatever tool it was written with. Web Audio needs
// no file at all, but on iOS it is the variant most reliably silenced by the ring/silent switch; an alarm that is quiet
// exactly when the bakery is loud is not an alarm. `alarm.wav` is one second, three beeps and a gap, so `loop` repeats it
// seamlessly (16 KB, 8 kHz mono). It is imported with `?url`, so the build gives it a real file of its own.
//
// ⚠️ AND THE SOUND IS NEVER THE ONLY SIGNAL. It can be muted by a hardware switch nobody in this app can read, so a finished
// step also lights the screen (the wake lock has kept it on), turns the card and says «Time is up» in words, and vibrates
// where that exists. If the beep never arrives, the guided mix still works.

// Stop after a minute. An alarm nobody is coming back to should not still be going when they do — and a phone left beeping
// on a bench for an hour is how a feature gets turned off for good.
export const MAX_RING_MS = 60 * 1000;
// Repeat the buzz while it rings; one pulse is missed by a hand in dough.
export const BUZZ_EVERY_MS = 2000;
// The vibration pattern mirrors the sound: three pulses, then quiet. Android honours it; iOS Safari has no Vibration API at
// all, which is why it can only ever be the third signal and never the first.
export const BUZZ = [180, 120, 180, 120, 180];

let audio: HTMLAudioElement | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let buzzTimer: ReturnType<typeof setInterval> | null = null;

function element(): HTMLAudioElement | null {
  if (audio !== null) return audio;
  try {
    audio = new Audio(alarmSrc);
    audio.loop = true;
    audio.preload = 'auto';
    // ⚠️ ASK FOR THE FILE NOW, at the tap that starts the timer, rather than leaving it to `preload`. A browser is free to
    // ignore preload, and the one moment the sound is needed — minutes later, on a phone in a bakery — is the worst possible
    // moment to discover it still has to be fetched.
    try { audio.load(); } catch { /* best-effort */ }
  } catch {
    audio = null;
  }
  return audio;
}

// ⚠️ EVERY ONE OF THESE CAN THROW ON ITS OWN (rewinding a clip the browser has not loaded yet is the usual culprit), and each
// is wrapped alone: THE ONLY LINE THAT MATTERS IS play(), AND IT MUST NEVER BE HOSTAGE TO THE LINES AROUND IT.
const attempt = (fn: () => void): void => {
  try { fn(); } catch { /* best-effort */ }
};

function play(sound: HTMLAudioElement): Promise<void> | null {
  try {
    const started = sound.play() as Promise<void> | undefined;
    if (started !== undefined && typeof started.then === 'function') {
      // A refusal (no gesture yet, no file) is swallowed: the screen and the buzz still signal.
      started.catch(() => undefined);
      return started;
    }
    return null;
  } catch {
    return null;
  }
}

const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// ⚠️ CALL THIS FROM A REAL TAP, AND ONLY FROM ONE. A browser refuses to play audio a person has not asked for, and the
// refusal lands LATER — at the moment the timer ends, when nobody is touching the screen to authorise it. So the sound is
// authorised in advance, on the tap that starts a timer: played muted for an instant and stopped again, which is enough for
// the browser to treat every later play as wanted.
export function unlockAlarm(): void {
  const sound = element();
  if (sound === null) return; // no audio on this device — the screen and the buzz still signal
  attempt(() => { sound.muted = true; });
  const started = play(sound);
  const settle = (): void => {
    attempt(() => { sound.pause(); });
    attempt(() => { sound.currentTime = 0; });
    attempt(() => { sound.muted = false; });
  };
  if (started !== null) started.then(settle, settle);
  else settle();
}

export function startAlarm(): void {
  stopAlarm();
  const sound = element();
  if (sound !== null) {
    // Order matters: unmute, then PLAY, and only then rewind. stopAlarm() above has already rewound it, so the rewind here is
    // belt-and-braces — which is exactly why it must come after the line that actually makes a sound.
    attempt(() => { sound.muted = false; });
    play(sound);
    attempt(() => { sound.currentTime = 0; });
  }

  if (canVibrate()) {
    attempt(() => { navigator.vibrate(BUZZ); });
    buzzTimer = setInterval(() => { attempt(() => { navigator.vibrate(BUZZ); }); }, BUZZ_EVERY_MS);
  }

  ringTimer = setTimeout(stopAlarm, MAX_RING_MS);
}

// Is the alarm sounding right now?
//
// ⚠️ THIS EXISTS SO THE ALARM CAN BE PROVED, and it earns its place: the element is detached (new Audio()), so nothing
// outside this file can reach it, which made the single most important signal in the feature unobservable. A driver proves
// the alarm with it. A safety signal nobody can inspect is a safety signal nobody can test.
export function isRinging(): boolean {
  return audio !== null && !audio.paused && !audio.muted;
}

export function stopAlarm(): void {
  if (ringTimer !== null) { clearTimeout(ringTimer); ringTimer = null; }
  if (buzzTimer !== null) { clearInterval(buzzTimer); buzzTimer = null; }
  if (audio !== null) {
    const sound = audio;
    // Separately again: a failed rewind must not leave the sound still playing.
    attempt(() => { sound.pause(); });
    attempt(() => { sound.currentTime = 0; });
  }
  if (canVibrate()) attempt(() => { navigator.vibrate(0); });
}
