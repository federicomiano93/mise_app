// app-version.js — pure helpers for the «App version» row in Home → Settings.
//
// The app records no per-device version on the server (privacy, by design), so each
// device answers for itself: the running cache name comes from its own service worker.

// 'theitalianclub-v546' → '546'. Anything else → null, never a guess.
export function versionNumber(cacheName) {
  const match = typeof cacheName === 'string' ? /-v(\d+)$/.exec(cacheName) : null;
  return match ? match[1] : null;
}

// undefined = still asking; null = nobody answered; waiting = a newer worker is ready.
export function versionState({ version, waiting } = {}) {
  if (version === undefined) return 'checking';
  if (version === null) return 'unknown';
  return waiting ? 'waiting' : 'current';
}
