import { createContext, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { MutableRefObject } from 'react';
import { KEEP_FOCUS } from '../shell/Page';
import { SETTINGS_PATH } from './settingsPath';
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

// What Back puts in the state when it REPLACES the screen with the page (opened by its address, nothing behind it): «this is a return, hand
// the focus to the door» — the page cannot tell it from the history action, which is a REPLACE, not a POP.
export const BACK_TO_SETTINGS = { ...KEEP_FOCUS, handBack: true } as const;

export function isHandBack(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'handBack' in state;
}

export function cameFromSettings(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromSettings' in state;
}

// One level up to the page, for a screen below Settings: its own Back and the «Done» of «New business» are the same step. Opened from
// the page, the entry behind IS the page, so it is the browser's Back; opened by its address there is nothing behind, so it REPLACES the
// screen with the page. The door is promised the focus either way.
export function useBackToSettings(door: SettingsDoor): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const pending = usePendingDoor();
  return () => {
    pending.current = door;
    if (cameFromSettings(state)) void navigate(-1);
    else void navigate(SETTINGS_PATH, { replace: true, state: BACK_TO_SETTINGS });
  };
}
