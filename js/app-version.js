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
