import { describe, expect, test, vi } from 'vitest';
import { createJoinFlow, PENDING_INVITE_KEY, takeJoinLink } from './joinFlow';
import type { AddressWindow } from './joinFlow';
import { memoryStorage } from '../testing/renderWithSession';

// The invitation a window holds and the join form (staff slice 1). The token in a join link is a key to a venue
// (docs/parity/staff-plan.md, «Security»): these specs pin that it leaves the address at once, is kept only in this
// window's storage, and is forgotten after joining and after Cancel. (Sign-out: SessionGate.join.spec.tsx and
// session.spec.ts.)

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const OTHER = 'zZ9dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';

function fakeWindow(href: string) {
  const url = new URL(href);
  const replaced: string[] = [];
  const win: AddressWindow = {
    location: { href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState: vi.fn((_data: unknown, _unused: string, to?: string) => { replaced.push(to ?? ''); }) },
  };
  return { win, replaced };
}

describe('takeJoinLink: the token leaves the address at once', () => {
  test('a join link gives its token and is replaced, in the same history entry, by the bare page', () => {
    const { win, replaced } = fakeWindow(`https://app.test/mise_app/index.html?x=1#join=${TOKEN}`);
    expect(takeJoinLink(win)).toBe(TOKEN);
    expect(replaced).toEqual(['/mise_app/index.html?x=1']);
    expect(replaced.join('')).not.toContain(TOKEN);
  });

  test('a link opened in a tab already running the app puts back the screen it was on, with its history state', () => {
    const { win, replaced } = fakeWindow(`https://app.test/index.html#join=${TOKEN}`);
    const state = { usr: null, key: 'k1', idx: 3 };
    expect(takeJoinLink(win, '#/orders', state)).toBe(TOKEN);
    expect(replaced).toEqual(['/index.html#/orders']);
    expect(win.history.replaceState).toHaveBeenCalledWith(state, '', '/index.html#/orders');
  });

  // Not a usable token, but still something a stranger put in the address: taken out, and never handed on.
  test('a malformed join link is taken out too, and gives nothing', () => {
    for (const bad of ['#join=', '#join=short', `#join=${'a'.repeat(31)}!`, '#join=123456']) {
      const { win, replaced } = fakeWindow(`https://app.test/index.html${bad}`);
      expect(takeJoinLink(win), bad).toBe('');
      expect(replaced, bad).toEqual(['/index.html']);
    }
  });

  test('any other address is left exactly as it is', () => {
    for (const hash of ['', '#', '#/orders', '#/recipes/r1', '#b=bakery&k=xyz']) {
      const { win } = fakeWindow(`https://app.test/index.html${hash}`);
      expect(takeJoinLink(win), hash).toBe('');
      expect(win.history.replaceState, hash).not.toHaveBeenCalled();
    }
  });

  test('a browser that refuses to rewrite the address still hands the token over', () => {
    const { win } = fakeWindow(`https://app.test/index.html#join=${TOKEN}`);
    vi.mocked(win.history.replaceState).mockImplementation(() => { throw new Error('SecurityError'); });
    expect(takeJoinLink(win)).toBe(TOKEN);
  });
});

describe('createJoinFlow: where the invitation lives', () => {
  test('a remembered invitation is kept in this window’s storage, under the current app’s key', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    flow.remember(TOKEN);
    expect(flow.getSnapshot().invited).toBe(TOKEN);
    expect(storage.map.get(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('it survives a reload of the same window', () => {
    const storage = memoryStorage({ [PENDING_INVITE_KEY]: TOKEN });
    expect(createJoinFlow(storage).getSnapshot().invited).toBe(TOKEN);
  });

  // ⚠️ What comes back from storage is no more trustworthy than the address: rubbish would spend a join attempt.
  test('anything in storage that is not a link token is ignored', () => {
    for (const stored of ['', '123456', 'short', `${'a'.repeat(31)}!`, ' '.repeat(40)]) {
      expect(createJoinFlow(memoryStorage({ [PENDING_INVITE_KEY]: stored })).getSnapshot().invited, stored).toBe('');
    }
  });

  test('remember ignores anything that is not a well-formed link token', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    for (const bad of ['', '123456', 'short', ` ${TOKEN}`]) flow.remember(bad);
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.size).toBe(0);
  });

  test('storage that throws: the invitation lives as long as the page', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const flow = createJoinFlow(broken);
    flow.remember(TOKEN);
    expect(flow.getSnapshot().invited).toBe(TOKEN);
    flow.forget();
    expect(flow.getSnapshot().invited).toBe('');
  });
});

describe('createJoinFlow: forgotten after joining and after Cancel', () => {
  test('forget drops it from memory and storage, and leaves the form as it is', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    flow.remember(TOKEN);
    flow.openForm();
    flow.forget();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: true });
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  test('forget(only) keeps a NEWER invitation', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.remember(OTHER);
    flow.forget(TOKEN);
    expect(flow.getSnapshot().invited).toBe(OTHER);
    flow.forget(OTHER);
    expect(flow.getSnapshot().invited).toBe('');
  });

  test('cancel forgets it and closes the form, marking the return', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    flow.remember(TOKEN);
    flow.openForm();
    flow.cancel();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: false, sent: null, returned: true });
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  test('after joining: the used invitation forgotten by name, then the form closed', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    flow.remember(TOKEN);
    flow.openForm();
    flow.sending();
    flow.forget(TOKEN);
    flow.finish();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: false, sent: null, returned: false });
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });
});

describe('createJoinFlow: the sent form (js/join-hold.js)', () => {
  test('sending holds the form with the invitation of the tap; answered keeps it, not busy', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.remember(TOKEN);
    flow.sending();
    expect(flow.getSnapshot().sent).toEqual({ busy: true, invited: TOKEN });
    flow.answered();
    expect(flow.getSnapshot().sent).toEqual({ busy: false, invited: TOKEN });
  });

  test('a new invitation never replaces a form being checked, and gets its own once the answer is in', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.remember(TOKEN);
    const key = flow.getSnapshot().formKey;
    flow.sending();
    flow.remember(OTHER);
    expect(flow.getSnapshot()).toMatchObject({ invited: OTHER, formKey: key, sent: { busy: true, invited: TOKEN } });
    flow.answered();
    expect(flow.getSnapshot()).toMatchObject({ invited: OTHER, formKey: key + 1, sent: null });
  });

  test('a new invitation while no form is being checked gets a fresh form at once', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.openForm();
    const key = flow.getSnapshot().formKey;
    flow.remember(TOKEN);
    expect(flow.getSnapshot().formKey).toBe(key + 1);
    flow.remember(TOKEN);
    expect(flow.getSnapshot().formKey).toBe(key + 1);
  });

  test('a listener hears every change, and stops hearing once unsubscribed', () => {
    const flow = createJoinFlow(memoryStorage());
    const heard = vi.fn();
    const stop = flow.subscribe(heard);
    flow.openForm();
    flow.remember(TOKEN);
    stop();
    flow.cancel();
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('createJoinFlow: stepping over to sign in (staff slice 2)', () => {
  test('signInInstead closes the form and KEEPS the invitation, in memory and in the window\'s storage', () => {
    const storage = memoryStorage({ [PENDING_INVITE_KEY]: TOKEN });
    const flow = createJoinFlow(storage);
    flow.openForm();
    flow.signInInstead('  anna@club.test ');
    expect(flow.getSnapshot()).toMatchObject({
      open: false, sent: null, invited: TOKEN, signInFirst: true, signInEmail: 'anna@club.test', returned: true,
    });
    expect(storage.map.get(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('the email is never written to storage', () => {
    const storage = memoryStorage();
    const flow = createJoinFlow(storage);
    flow.signInInstead('anna@club.test');
    expect([...storage.map.values()].join(' ')).not.toContain('anna@club.test');
  });

  test('opening the form, Cancel, finishing and a NEW invitation each end it', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.signInInstead('anna@club.test');
    flow.openForm();
    expect(flow.getSnapshot()).toMatchObject({ signInFirst: false, signInEmail: '' });
    flow.signInInstead('anna@club.test');
    flow.cancel();
    expect(flow.getSnapshot()).toMatchObject({ signInFirst: false, signInEmail: '' });
    flow.signInInstead();
    flow.finish();
    expect(flow.getSnapshot().signInFirst).toBe(false);
    flow.remember(TOKEN);
    flow.signInInstead();
    flow.remember(OTHER);
    expect(flow.getSnapshot()).toMatchObject({ signInFirst: false, invited: OTHER });
  });

  test('the same invitation opened again does not take the person back from the sign-in form', () => {
    const flow = createJoinFlow(memoryStorage());
    flow.remember(TOKEN);
    flow.signInInstead();
    flow.remember(TOKEN);
    expect(flow.getSnapshot().signInFirst).toBe(true);
  });
});
