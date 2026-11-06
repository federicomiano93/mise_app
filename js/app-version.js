// app-version.js — pure helpers for the «App version» row in Home → Settings.
//
// Each device answers for itself: the running cache name comes from its own service worker.
// (A device also reports its release once a day to locations/{lid}/devices, js/device-ping.js,
// but only the owner's script can read that; the app never does.)

// 'theitalianclub-v546' → '546'. Anything else → null, never a guess.
export function versionNumber(cacheName) {
  const match = typeof cacheName === 'string' ? /-v(\d+)$/.exec(cacheName) : null;
  return match ? match[1] : null;
}

// version: undefined = still asking, null = nobody answered.
// phase: the check for a newer release — checking | downloading | failed | done.
// ⚠️ A waiting worker is the first answer: it must show its button even when the
// running version could not be read. «Up to date» is only said once the check is done.
export function versionState({ version, waiting, phase } = {}) {
  if (waiting) return 'waiting';
  if (phase === 'downloading') return 'downloading';
  if (phase === 'failed') return 'failed';
  if (phase === 'checking' || version === undefined) return 'checking';
  return version === null ? 'unknown' : 'current';
}

// Asks a service worker which release it is, over a private channel. The controller is
// passed in (no navigator here). A worker that was just started can miss the first ask,
// so a timeout is retried. Resolves the string, or null; never throws.
export async function askVersionOf(controller, { timeoutMs = 2000, attempts = 3 } = {}) {
  if (!controller || typeof controller.postMessage !== 'function') return null;
  for (let i = 0; i < attempts; i += 1) {
    const answer = await askOnce(controller, timeoutMs);
    if (answer !== undefined) return answer;
  }
  return null;
}

// The release THIS page runs, as a number ('741'), or null. Used by the statistics and the notes
// (device-ping, usage, error-report, feedback), never by the Settings row, which watches the
// controller itself. A page with no controller (the first visit, or a reload that bypassed the
// worker, Ctrl+Shift+R on a computer) asks the registration's active worker instead: that page was
// loaded from the network, so the active worker is its release (or, at worst, one behind while a
// newer one waits). Before this fallback such a page reported «unknown» for the whole day.
// `nav` exists for the tests; never throws.
export async function askPageVersion(options, nav = globalThis.navigator) {
  try {
    const sw = nav && nav.serviceWorker;
    if (!sw) return null;
    let worker = sw.controller || null;
    if (!worker && typeof sw.getRegistration === 'function') {
      const registration = await sw.getRegistration();
      worker = registration && registration.active ? registration.active : null;
    }
    return versionNumber(await askVersionOf(worker, options));
  } catch {
    return null;
  }
}

// undefined = timed out (worth another try); null = answered, but nonsense.
function askOnce(controller, timeoutMs) {
  return new Promise(resolve => {
    let channel;
    let timer;
    const finish = value => {
      clearTimeout(timer);
      if (channel) { channel.port1.onmessage = null; channel.port1.close(); }
      resolve(value);
    };
    try {
      channel = new MessageChannel();
      timer = setTimeout(() => finish(undefined), timeoutMs);
      channel.port1.onmessage = event => {
        const version = event && event.data && event.data.version;
        finish(typeof version === 'string' ? version : null);
      };
      controller.postMessage({ action: 'version' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}
