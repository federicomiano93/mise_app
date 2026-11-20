// restNow.ts — the Home's «Standby» pill telling the kiosk to cover the screen now (staff slice 6; the current app's window event
// `kiosk-rest-now`). The kiosk is mounted beside the session gate, the Home inside a section: a tiny register joins them without the
// Home importing the kiosk's screens. Nothing happens unless kiosk mode is on and a person is signed in (shouldRestNow).

const listeners = new Set<() => void>();

export function onRestNow(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestRestNow(): void {
  for (const listener of [...listeners]) listener();
}
