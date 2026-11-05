import { describe, expect, it } from 'vitest';
import { WEEKDAYS } from '@mise/shared/pastries-model';
import { sectionById } from '../shell/sections';
import { parsePastriesPath } from './pastriesPath';
import { PASTRIES_PATH, RECORDS_PATH, dayPath, editorPath } from './weekdays';

describe('parsePastriesPath', () => {
  it.each([undefined, '', '/'])('%j is the opening day', rest => {
    expect(parsePastriesPath(rest)).toEqual({ kind: 'day', day: null });
  });

  it.each(WEEKDAYS)('%s is that day, with or without a trailing slash', day => {
    expect(parsePastriesPath(day)).toEqual({ kind: 'day', day });
    expect(parsePastriesPath(`${day}/`)).toEqual({ kind: 'day', day });
  });

  it.each(WEEKDAYS)('%s/edit is the editor of that day', day => {
    expect(parsePastriesPath(`${day}/edit`)).toEqual({ kind: 'editor', day });
    expect(parsePastriesPath(`${day}/edit/`)).toEqual({ kind: 'editor', day });
  });

  it('records is Records', () => {
    expect(parsePastriesPath('records')).toEqual({ kind: 'records' });
    expect(parsePastriesPath('records/')).toEqual({ kind: 'records' });
  });

  // The day in the address is the stored id, never the word a person reads, and never a guess.
  it.each([
    'tuesday',
    'TUESDAY',
    'Martedì',
    'Funday',
    'Tuesday/editor',
    'Tuesday/edit/extra',
    'records/edit',
    'Records',
    'edit',
    'Tuesday/Wednesday',
    'a/b/c',
  ])('%s is unknown', rest => {
    expect(parsePastriesPath(rest)).toEqual({ kind: 'unknown' });
  });
});

describe('the addresses of Pastries', () => {
  it('start at the section\'s own path', () => {
    expect(PASTRIES_PATH).toBe(sectionById('pastries').path);
    expect(RECORDS_PATH).toBe('/pastries/records');
    expect(dayPath('Tuesday')).toBe('/pastries/Tuesday');
    expect(editorPath('Tuesday')).toBe('/pastries/Tuesday/edit');
  });

  it('are read back to what they were built from', () => {
    for (const day of WEEKDAYS) {
      expect(parsePastriesPath(dayPath(day).slice(PASTRIES_PATH.length + 1))).toEqual({ kind: 'day', day });
      expect(parsePastriesPath(editorPath(day).slice(PASTRIES_PATH.length + 1))).toEqual({ kind: 'editor', day });
    }
    expect(parsePastriesPath(RECORDS_PATH.slice(PASTRIES_PATH.length + 1))).toEqual({ kind: 'records' });
  });
});
