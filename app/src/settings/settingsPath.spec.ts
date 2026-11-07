import { describe, expect, it } from 'vitest';
import { screenNameFor } from '../shell/sections';
import { settingsScreenName, settingsScreenOf } from './settingsPath';

describe('the addresses of Settings', () => {
  it.each([
    ['/settings', 'page'],
    ['/settings/', 'page'],
    ['/settings/language', 'language'],
    ['/settings/language/', 'language'],
    ['/settings/sections', 'sections'],
    ['/settings/people', 'unknown'],
    ['/settings/language/more', 'unknown'],
    ['/settings/Language', 'unknown'],
  ])('%s is %s', (pathname, expected) => {
    expect(settingsScreenOf(pathname)).toBe(expected);
  });

  it.each([
    ['/settings', 'settings'],
    ['/settings/language', 'settings-language'],
    ['/settings/sections', 'settings-sections'],
    ['/settings/nonsense', 'settings'],
  ])('%s is called %s in the usage record', (pathname, expected) => {
    expect(settingsScreenName(pathname)).toBe(expected);
    expect(screenNameFor(pathname)).toBe(expected);
  });
});
