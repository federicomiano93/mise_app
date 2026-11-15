import { describe, expect, it } from 'vitest';
import type { Log } from '@mise/shared/log-model';
import { versionKind, versionsOf, visibleLogs } from './logsModel';

const NOW = new Date(2026, 9, 12, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;

function log(id: string, recipeId: string, ageHours: number, over: Partial<Log> = {}): Log {
  return { id, bakery: 'b', dough: recipeId, recipeId, forDay: 'today', origin: 'calculator', createdAtMs: NOW - ageHours * HOUR, versions: [], ...over };
}

const config = {
  recipes: [{ id: 'focaccia' }, { id: 'brioche' }],
  logVisibility: { brioche: false },
  logRetentionHours: 24,
  logRetentionByDough: { focaccia: 48 },
};

describe('the logs the list shows', () => {
  it('hides a recipe the settings hide, and sorts newest first', () => {
    const shown = visibleLogs(config, [log('a', 'focaccia', 5), log('b', 'brioche', 1), log('c', 'focaccia', 2)], NOW);
    expect(shown.map(l => l.id)).toEqual(['c', 'a']);
  });

  it('drops a log past its recipe\'s own window, counted from the end of the day it is for', () => {
    const old = log('old', 'focaccia', 80);
    const fresh = log('fresh', 'focaccia', 30);
    expect(visibleLogs(config, [old, fresh], NOW).map(l => l.id)).toEqual(['fresh']);
  });

  it('keeps a log of a recipe the configuration does not know', () => {
    expect(visibleLogs(config, [log('x', 'gone', 1)], NOW).map(l => l.id)).toEqual(['x']);
  });
});

describe('versions', () => {
  it('reads a document with no list of versions as having none', () => {
    expect(versionsOf({ ...log('a', 'x', 1), versions: 'bad' as unknown as [] })).toEqual([]);
  });

  it('names the first created, a restore by its source (1-based), the rest edited', () => {
    expect(versionKind({ kind: 'create' }, 0)).toEqual({ kind: 'created' });
    expect(versionKind({ kind: 'edit' }, 1)).toEqual({ kind: 'edited' });
    expect(versionKind({ kind: 'restore', restoredFrom: 0 }, 3)).toEqual({ kind: 'restored', from: 1 });
    expect(versionKind({ kind: 'restore', restoredFrom: 2 }, 4)).toEqual({ kind: 'restored', from: 3 });
  });
});
