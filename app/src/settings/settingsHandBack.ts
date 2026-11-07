import { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';
import { KEEP_FOCUS } from '../shell/Page';
import type { SettingsDoor } from './settingsPath';

// Back from a screen below Settings hands the focus back to the door that opened it, so a keyboard or screen-reader user lands where they
// left instead of at the top of the page (the shape of orders/handBack.ts, cut down to two doors).
//
// ⚠️ PROMISED WHEN THE SCREEN OPENS, not when its own Back is pressed: a phone's back gesture is the browser's Back and runs no code of the
// screen it leaves. The door writes its name here as it opens the screen; SettingsSection keeps the box alive across both screens, and the
// page takes the focus to that door, once, when it is on show again.
export type PendingDoor = MutableRefObject<SettingsDoor | null>;

export const HandBackContext = createContext<PendingDoor>({ current: null });

export function usePendingDoor(): PendingDoor {
  return useContext(HandBackContext);
}

// What a door puts in the navigation `state`: «you came from Settings, so Back is the browser's Back». KEEP_FOCUS comes with it: the page
// then leaves the focus alone, and the screen that opens puts it on its own title.
export const FROM_SETTINGS = { ...KEEP_FOCUS, fromSettings: true } as const;

export function cameFromSettings(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromSettings' in state;
}
