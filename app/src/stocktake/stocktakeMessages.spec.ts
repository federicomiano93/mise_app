import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { messageText } from './stocktakeMessages';

const t = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);

describe('messageText', () => {
  it('says a count is not saved online yet to everybody', () => {
    for (const canManage of [true, false]) {
      expect(messageText(t, { kind: 'not-saved-yet' }, canManage)).toBe(
        'Not saved online yet. The count is safe on this phone and goes up on its own.',
      );
    }
  });

  it('says the live updates were interrupted to whoever runs the place', () => {
    expect(messageText(t, { kind: 'month-stream-broken' }, true)).toBe(
      'Live updates interrupted — reopen the page to reconnect.',
    );
  });

  // For an employee a refused stream is the rules keeping a closed month from them: the screen has
  // a sentence for that, and «interrupted» over it would read as a broken app.
  it('says nothing about a broken month stream to an employee', () => {
    expect(messageText(t, { kind: 'month-stream-broken' }, false)).toBeNull();
  });
});
