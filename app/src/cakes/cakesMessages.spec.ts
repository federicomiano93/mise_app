import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { cakesMessageText } from './cakesMessages';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

describe('cakesMessageText', () => {
  it('says the stream broke, in both languages', () => {
    expect(cakesMessageText(english, { kind: 'cakes-stream-broken' })).toBe('Live sync interrupted — cakes may be out of date.');
    expect(cakesMessageText(italiano, { kind: 'cakes-stream-broken' })).toBe('Sincronizzazione interrotta — le torte potrebbero non essere aggiornate.');
  });

  it('says the reference grams are back as they were, in both languages', () => {
    expect(cakesMessageText(english, { kind: 'reference-not-saved' })).toContain('They are back as they were.');
    expect(cakesMessageText(italiano, { kind: 'reference-not-saved' })).toContain('Sono tornati com’erano.');
  });
});
