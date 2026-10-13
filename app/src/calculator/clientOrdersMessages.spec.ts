import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { clientOrdersMessageText } from './clientOrdersMessages';

const say = (lang: 'en' | 'it') => (key: MessageKey, params?: MessageParams) => format(lang, (lang === 'it' ? italian : en)[key], params);

describe('clientOrdersMessageText', () => {
  it('says an order that could not be recorded as used, and that the app will not warn about a change', () => {
    expect(clientOrdersMessageText(say('en'), { kind: 'applied-not-recorded' }))
      .toBe(en['calc.clientOrders.notRecorded']);
    expect(clientOrdersMessageText(say('en'), { kind: 'applied-not-recorded' })).toContain('NOT warn you');
    expect(clientOrdersMessageText(say('it'), { kind: 'applied-not-recorded' })).toContain('NON ti avviserà');
  });

  it('says a deadline that was not saved', () => {
    expect(clientOrdersMessageText(say('en'), { kind: 'cutoff-not-saved' }))
      .toBe('Not saved: check the connection and try again.');
    expect(clientOrdersMessageText(say('it'), { kind: 'cutoff-not-saved' }))
      .toBe('Non salvato: controlla la connessione e riprova.');
  });
});
