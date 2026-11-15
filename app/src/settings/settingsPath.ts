// The addresses of Settings: the page, the two screens one level below it that an owner or a manager reaches, and «Who can get in», which
// only the full owner reaches. Anything else under `/settings/…` goes back to the page.

export const SETTINGS_PATH = '/settings';
export const LANGUAGE_PATH = '/settings/language';
export const SECTIONS_PATH = '/settings/sections';
// The current app's screen is «people» too (js/staff/people.js).
export const PEOPLE_PATH = '/settings/people';

// The doors of the page, by the name the Back button of a sub-screen hands the focus back to.
export type SettingsDoor = 'language' | 'sections' | 'people';

export type SettingsScreen = 'page' | SettingsDoor | 'unknown';

// Which screen an address is. A trailing slash is the same address; `unknown` is anything else under /settings.
export function settingsScreenOf(pathname: string): SettingsScreen {
  const clean = pathname.replace(/\/+$/, '');
  if (clean === SETTINGS_PATH) return 'page';
  if (clean === LANGUAGE_PATH) return 'language';
  if (clean === SECTIONS_PATH) return 'sections';
  if (clean === PEOPLE_PATH) return 'people';
  return 'unknown';
}

// What the usage record and the error report call each screen. `settings` is also the Calculator's Settings (the owner's statistics
// count the two together, the decision of 12 Oct 2026).
export function settingsScreenName(pathname: string): string {
  const screen = settingsScreenOf(pathname);
  if (screen === 'language') return 'settings-language';
  if (screen === 'sections') return 'settings-sections';
  if (screen === 'people') return 'settings-people';
  return 'settings';
}
