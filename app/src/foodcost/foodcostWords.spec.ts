import { describe, expect, it } from 'vitest';
import { unpricedReasonText } from '@mise/shared/foodcost-model';
import { en } from '../i18n/en';
import type { MessageKey, Messages } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { Language, MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { foodcostTranslate } from './foodcostWords';

// The shared model asks for its words by dictionary KEY (item 26). The app must have every one of them, in both languages, or a
// reason would print as a bare key.

const say = (lang: Language, messages: Messages) => (key: MessageKey, params?: MessageParams) => format(lang, messages[key], params);

const REASONS = ['no-ingredient-price', 'packaging-no-price', 'no-piece-weight', 'no-piece-price', 'packaging-no-mode', 'packaging-no-units',
  'recipe-no-price', 'gone', 'not-weighable', 'no-amount', 'not-linked', 'missing-ingredient', 'missing-recipe', 'no-price',
  'sub-not-costable', 'cycle', 'too-deep'];

describe('the words the shared Food cost model asks for', () => {
  for (const [name, messages, lang] of [['English', en, 'en'], ['Italian', italian, 'it']] as const) {
    it(`${name}: every reason of «Which?» is a real sentence, not a key`, () => {
      const t = foodcostTranslate(say(lang, messages));
      for (const reason of REASONS) {
        const text = unpricedReasonText(reason, t);
        expect(text, reason).not.toBe('');
        expect(text, reason).not.toMatch(/^(fc|cat)\./);
      }
    });

    it(`${name}: a line that no longer exists and packaging have their names`, () => {
      const t = foodcostTranslate(say(lang, messages));
      for (const key of ['fc.thisItemNoLonger', 'fc.thisRecipeNoLonger', 'fc.unpriced.packagingName']) {
        expect(t(key), key).not.toBe(key);
        expect(t(key), key).not.toBe('');
      }
    });
  }

  it('words the Italian ones in Italian', () => {
    const t = foodcostTranslate(say('it', italian));
    expect(unpricedReasonText('no-ingredient-price', t)).toBe('senza prezzo');
    expect(unpricedReasonText('not-linked', t)).toBe('non collegato a un ingrediente');
  });
});
