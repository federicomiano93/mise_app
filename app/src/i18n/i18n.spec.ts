import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from './en';
import type { Message, Messages, PluralMessage } from './en';
import { it as italian } from './it';
import { format, loadLanguage, localeOf, pickLanguage } from './i18n';

const placeholdersOf = (message: Message): string[] => {
  const strings = typeof message === 'string' ? [message] : Object.values(message);
  return strings.flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? '')).sort();
};

describe('the message catalogues', () => {
  // The compiler already refuses a missing or an extra key in it.ts; this is the runtime
  // twin, so a catalogue cast past the type-check still fails here.
  it('Italian has exactly the keys English has', () => {
    expect(Object.keys(italian).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message has the same {placeholders} in both languages', () => {
    const differing: string[] = [];
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const english = placeholdersOf(en[key]);
      const translated = placeholdersOf(italian[key]);
      if (english.join() !== translated.join()) differing.push(key);
    }
    expect(differing).toEqual([]);
  });

  it('a message is a string in both languages or a plural in both', () => {
    const differing: string[] = [];
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      if (typeof en[key] !== typeof italian[key]) differing.push(key);
    }
    expect(differing).toEqual([]);
  });

  // Checked by `tsc`, not at run time: if a missing or an extra key ever stops being an error,
  // these two directives become "unused @ts-expect-error" errors and the build fails.
  it('a catalogue with a missing or an extra key does not compile', () => {
    // @ts-expect-error — every other key is missing
    const missing: Messages = { 'app.name': 'Mise' };
    const extra: Messages = {
      ...en,
      // @ts-expect-error — not a message key
      'no.such.key': 'x',
    };
    expect([missing, extra]).toHaveLength(2);
  });

  // The current app's dictionary prints ’ (U+2019), never the typewriter ' (U+0027): the two
  // look different in Geist, and a screen that mixes them reads as careless.
  it('no message contains a straight apostrophe', () => {
    const straight: string[] = [];
    for (const [language, messages] of [['en', en], ['it', italian]] as const) {
      for (const [key, message] of Object.entries<Message>(messages)) {
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        if (texts.some(text => text.includes("'"))) straight.push(`${language}: ${key}`);
      }
    }
    expect(straight).toEqual([]);
  });

  it('no message is empty', () => {
    for (const messages of [en, italian]) {
      for (const [key, message] of Object.entries<Message>(messages)) {
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        for (const text of texts) expect(text.trim(), key).not.toBe('');
      }
    }
  });
});

// ⚠️ A SENTENCE WITH A WEEKDAY IN IT MUST FIT ALL SEVEN. «Domenica» is feminine, the other six days
// are masculine, so «{day} registrato» or «{day} fatto» is right six days in seven and wrong on
// Sunday. A weekday is the subject of no adjective or participle: the sentence is about «la lista di
// {day}», or puts the day last («Salvato: {day}.»).
describe('the Italian sentences that name a weekday', () => {
  const withDay = Object.entries<Message>(italian)
    .filter(([key]) => key.startsWith('past.'))
    .flatMap(([key, message]) => {
      const texts = typeof message === 'string' ? [message] : Object.values(message);
      return texts.filter(text => text.includes('{day}')).map(text => [key, text] as const);
    });

  it('finds them (the guard below is not looking at nothing)', () => {
    expect(withDay.length).toBeGreaterThan(10);
    expect(withDay.map(([key]) => key)).toContain('past.daySaved');
  });

  // Words that would have to agree with the day: masculine participles and adjectives, and the
  // pronoun «lo» that points back at it. A participle followed by a colon is a label with the day
  // after it («Salvato: {day}.»), which agrees with nothing.
  const MASCULINE = /\b(fatto|registrato|salvato|vuoto|pronto|confermato|modificato|cambiato|aggiornato|completato|chiuso|aperto)\b(?!:)|\b(cambiarlo|modificarlo|toglierlo|salvarlo|registrarlo)\b/i;

  it.each(withDay)('%s has nothing in it that agrees with the day: %s', (_key, text) => {
    expect(text).not.toMatch(MASCULINE);
  });

  it.each(['Lunedì', 'Giovedì', 'Domenica'])('reads right for %s', day => {
    expect(format('it', italian['past.daySaved'], { day })).toBe(`Salvato: ${day}.`);
    expect(format('it', italian['past.dayRecorded'], { day })).toBe(`Registrato: ${day}.`);
    expect(format('it', italian['past.alreadyRecordedTonight'], { day }))
      .toBe(`La lista di ${day} è già registrata per stanotte. Modificare queste quantità?`);
    expect(format('it', italian['past.willShowAsDone'], { day }))
      .toBe(`La lista di ${day} risulterà fatta. Puoi ancora cambiarla — te lo chiederà prima.`);
  });
});

describe('pickLanguage', () => {
  it.each([
    ['it-IT', 'it'],
    ['IT', 'it'],
    ['it', 'it'],
    ['fr-FR', 'en'],
    ['en-GB', 'en'],
    ['', 'en'],
    [undefined, 'en'],
    [null, 'en'],
  ] as const)('%j → %s', (tag, expected) => {
    expect(pickLanguage(tag)).toBe(expected);
  });
});

describe('localeOf', () => {
  it('uses the Italian and the British locale', () => {
    expect(localeOf('it')).toBe('it-IT');
    expect(localeOf('en')).toBe('en-GB');
  });
});

describe('format', () => {
  it('fills a placeholder in', () => {
    expect(format('en', '{title} · Mise', { title: 'Orders' })).toBe('Orders · Mise');
  });

  it('fills the same placeholder wherever it appears', () => {
    expect(format('en', '{a} and {a}', { a: 'x' })).toBe('x and x');
  });

  it('leaves a placeholder nobody supplied visible instead of crashing', () => {
    expect(format('en', 'Hello {name}', {})).toBe('Hello {name}');
    expect(format('en', 'Hello {name}')).toBe('Hello {name}');
    expect(format('en', 'Hello {constructor}', {})).toBe('Hello {constructor}');
  });

  it('formats a number for the language', () => {
    expect(format('en', '{n} items', { n: 12000 })).toBe('12,000 items');
    expect(format('it', '{n} elementi', { n: 12000 })).toBe('12.000 elementi');
  });

  // ⚠️ CLDR gives Italian a "minimum grouping digits" of 2: a four-digit number is NOT grouped
  // («1000», not «1.000»), English groups from four digits. Pinned so nobody "fixes" it.
  it('follows the platform for four-digit numbers', () => {
    expect(format('en', '{n}', { n: 1000 })).toBe('1,000');
    expect(format('it', '{n}', { n: 1000 })).toBe('1000');
  });

  describe('plurals', () => {
    const items: PluralMessage = { one: '{n} item', other: '{n} items' };

    it('picks one and other in English', () => {
      expect(format('en', items, { n: 1 })).toBe('1 item');
      expect(format('en', items, { n: 0 })).toBe('0 items');
      expect(format('en', items, { n: 2 })).toBe('2 items');
    });

    it('picks one and other in Italian (zero is «other»)', () => {
      const elementi: PluralMessage = { one: '{n} elemento', other: '{n} elementi' };
      expect(format('it', elementi, { n: 1 })).toBe('1 elemento');
      expect(format('it', elementi, { n: 0 })).toBe('0 elementi');
      expect(format('it', elementi, { n: 2 })).toBe('2 elementi');
    });

    it('formats the number in the plural form it selects', () => {
      expect(format('en', items, { n: 1200 })).toBe('1,200 items');
    });

    it('follows the rule of the language, not the number: English never selects «zero»', () => {
      expect(format('en', { ...items, zero: 'no items' }, { n: 0 })).toBe('0 items');
    });

    it('falls back to «other» when the selected form is missing', () => {
      // Italian selects `many` for 1,000,000; a message without it must not print «undefined».
      const elementi: PluralMessage = { one: '{n} elemento', other: '{n} elementi' };
      expect(format('it', elementi, { n: 1_000_000 })).toBe('1.000.000 elementi');
    });

    it('uses the provided form when the language selects it', () => {
      const elementi: PluralMessage = {
        one: '{n} elemento',
        many: '{n} di elementi',
        other: '{n} elementi',
      };
      expect(format('it', elementi, { n: 1_000_000 })).toBe('1.000.000 di elementi');
    });

    it('uses «other» when there is no numeric n', () => {
      expect(format('en', items)).toBe('{n} items');
      expect(format('en', items, { n: '1' })).toBe('1 items');
    });

    // ⚠️ THE NAME IS `n`, as in the current app (js/i18n.js translate()). `{ count }` is not
    // the number that picks the form: the message falls to «other» and keeps a literal «{n}».
    // Pinned so a port of the current app's counted messages (step 3) cannot silently break.
    it('does not read a number called count: it is n', () => {
      expect(format('en', items, { count: 1 })).toBe('{n} items');
      expect(format('it', { one: '{n} elemento', other: '{n} elementi' }, { count: 1 })).toBe('{n} elementi');
    });
  });
});

describe('loadLanguage', () => {
  it('resolves English at once', async () => {
    const loaded = await loadLanguage('en');
    expect(loaded.lang).toBe('en');
    expect(loaded.messages).toBe(en);
  });

  it('resolves the Italian messages', async () => {
    const loaded = await loadLanguage('it');
    expect(loaded.lang).toBe('it');
    expect(loaded.messages).toStrictEqual(italian);
  });
});

describe('loadLanguage when the Italian chunk cannot be fetched', () => {
  afterEach(() => {
    vi.doUnmock('./it');
    vi.resetModules();
  });

  it('resolves English instead of rejecting', async () => {
    vi.resetModules();
    vi.doMock('./it', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const offline = await import('./i18n');
    const english = (await import('./en')).en;

    const loaded = await offline.loadLanguage('it');

    expect(loaded.lang).toBe('en');
    expect(loaded.messages).toBe(english);
  });
});
