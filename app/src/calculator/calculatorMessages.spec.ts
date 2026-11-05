import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { messageText, problemSentence } from './calculatorMessages';
import type { TabResult } from './calculatorResult';

const say = (lang: 'en' | 'it') => (key: MessageKey, params?: MessageParams) => format(lang, (lang === 'it' ? italian : en)[key], params);

describe('messageText', () => {
  it('names the dough that was not saved, in both languages', () => {
    expect(messageText(say('en'), { kind: 'log-not-saved', dough: 'Focaccia' }))
      .toBe('Focaccia was not saved to the Dough history. Check the connection and confirm again.');
    expect(messageText(say('it'), { kind: 'log-not-saved', dough: 'Focaccia' }))
      .toBe('Focaccia non è stato salvato nello storico impasti. Controlla la connessione e conferma di nuovo.');
  });

  it('names the dough whose log is full, in both languages', () => {
    expect(messageText(say('en'), { kind: 'log-full', dough: 'Focaccia' }))
      .toBe('Focaccia’s log is full. Reset the fields to start a new one.');
    expect(messageText(say('it'), { kind: 'log-full', dough: 'Focaccia' }))
      .toBe('Il registro di Focaccia è pieno. Azzera i campi per iniziarne uno nuovo.');
  });

  it('says nothing out loud for a stream that died: the empty state and the offline banner speak', () => {
    expect(messageText(say('en'), { kind: 'config-stream-broken' })).toBeNull();
    expect(messageText(say('en'), { kind: 'logs-stream-broken' })).toBeNull();
  });
});

describe('problemSentence', () => {
  const none: TabResult = { kind: 'none', target: 0 };

  it('has no sentence when there is nothing wrong or nothing to make', () => {
    expect(problemSentence(say('en'), none)).toBeNull();
  });

  it('keeps «still loading», «gone», «empty» and «unweighable» apart, the row named', () => {
    const t = say('en');
    const sentences = [
      problemSentence(t, { kind: 'loading', target: 1 }),
      problemSentence(t, { kind: 'problem', target: 1, problem: 'missing', row: '' }),
      problemSentence(t, { kind: 'problem', target: 1, problem: 'empty', row: '' }),
      problemSentence(t, { kind: 'problem', target: 1, problem: 'unweighable', row: 'Pinch of salt' }),
    ];
    expect(new Set(sentences).size).toBe(4);
    expect(sentences[3]).toContain('“Pinch of salt”');
  });
});
