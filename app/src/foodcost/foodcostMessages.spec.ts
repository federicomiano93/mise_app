import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { messageText } from './foodcostMessages';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

describe('messageText', () => {
  it('names the product that was not saved', () => {
    expect(messageText(english, { kind: 'product-not-saved', name: 'Cornetto' })).toBe(
      'Couldn’t save “Cornetto” — check your connection.',
    );
  });

  it('calls a product with no name «product»', () => {
    for (const name of ['', '   ']) {
      expect(messageText(english, { kind: 'product-not-saved', name })).toBe(
        'Couldn’t save “product” — check your connection.',
      );
    }
    expect(messageText(italiano, { kind: 'product-not-saved', name: '' })).toBe(
      'Non è stato possibile salvare “prodotto” — controlla la connessione.',
    );
  });

  it('names the recipe whose oven loss was not saved', () => {
    expect(messageText(english, { kind: 'loss-not-saved', name: 'Dough' })).toBe(
      'The oven loss of “Dough” was not saved — the recipe keeps the one it had.',
    );
  });

  it('says a product was not deleted', () => {
    expect(messageText(english, { kind: 'product-not-deleted' })).toBe(
      'Couldn’t delete the product — check your connection.',
    );
  });

  it('says the labour rate was not saved', () => {
    expect(messageText(english, { kind: 'rate-not-saved' })).toBe(
      'The hourly labour cost was not saved — only an owner or a manager can change it.',
    );
  });

  it('says the live updates of the products were interrupted', () => {
    expect(messageText(english, { kind: 'products-stream-broken' })).toBe(
      'Live sync interrupted — products may be out of date.',
    );
    expect(messageText(italiano, { kind: 'products-stream-broken' })).toBe(
      'Sincronizzazione interrotta — i prodotti potrebbero non essere aggiornati.',
    );
  });
});
