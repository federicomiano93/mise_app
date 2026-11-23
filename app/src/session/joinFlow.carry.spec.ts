import { describe, expect, test } from 'vitest';
import { createJoinFlow, PENDING_INVITE_KEY } from './joinFlow';
import { memoryStorage } from '../testing/renderWithSession';

// Going back from «Check your email»: the account is removed, the session signs out, and the fresh form that follows starts with what
// had been typed (names and the email), held through that one sign-out only.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const carry = { firstName: 'Anna', lastName: 'Bianchi', email: 'anna.b@club.test' };

describe('carryToNextForm: the fresh form after going back from «Check your email»', () => {
  test('with the hold, the next form is opened and carries it; the invitation is kept', () => {
    const storage = memoryStorage({ [PENDING_INVITE_KEY]: TOKEN });
    const flow = createJoinFlow(storage);
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    const before = flow.getSnapshot().formKey;
    flow.signedOut();
    expect(flow.getSnapshot()).toMatchObject({ invited: TOKEN, open: true, carried: carry });
    expect(flow.getSnapshot().formKey).toBe(before + 1);
    expect(storage.map.get(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('a code typed by hand (no invitation) still gets its form back', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    flow.signedOut();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: true, carried: carry });
  });

  test('it is used once: a later sign-out, a new form or a cancel drop it', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    flow.signedOut();
    flow.holdThroughSignOut(true);
    flow.signedOut();
    expect(flow.getSnapshot().carried ?? null).toBeNull();
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    flow.signedOut();
    flow.openForm();
    expect(flow.getSnapshot().carried ?? null).toBeNull();
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    flow.signedOut();
    flow.cancel();
    expect(flow.getSnapshot().carried ?? null).toBeNull();
  });

  test('holdThroughSignOut(false) takes the carry back with the hold', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.carryToNextForm(carry);
    flow.holdThroughSignOut(true);
    flow.holdThroughSignOut(false);
    flow.signedOut();
    expect(flow.getSnapshot().open).toBe(false);
    expect(flow.getSnapshot().carried ?? null).toBeNull();
  });
});
