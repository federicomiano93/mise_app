import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSettingsSource, member } from '../testing/fakeSettingsSource';
import { createPeopleStore } from './peopleStore';
import type { Member, SettingsSource } from './settingsSource';

// The roster for as long as the people list is on screen: one listener from start() to stop(), nothing after stop() (a sign-out or a
// change of venue takes the screen off before Firestore is stopped), and never an email or a uid in the console.

afterEach(() => { vi.restoreAllMocks(); });

const ANNA = member('anna1', { email: 'anna@club.test', firstName: 'Anna', lastName: 'Rossi' });

describe('the people store', () => {
  it('is loading until the first answer, then holds the roster, and follows every change', () => {
    const source = fakeSettingsSource({ members: [ANNA] });
    const store = createPeopleStore(source);
    expect(store.getSnapshot()).toEqual({ status: 'loading', members: [] });
    const heard = vi.fn();
    store.subscribe(heard);
    store.start();
    expect(store.getSnapshot()).toEqual({ status: 'ready', members: [ANNA] });
    source.members = [ANNA, member('b')];
    expect(store.getSnapshot().members).toHaveLength(2);
    expect(heard).toHaveBeenCalled();
  });

  it('holds ONE listener from start to stop, and none after', () => {
    const source = fakeSettingsSource({ members: [ANNA] });
    const store = createPeopleStore(source);
    store.start();
    store.start();
    expect(source.watchMembers).toHaveBeenCalledTimes(1);
    expect(source.liveMembers).toBe(1);
    store.stop();
    expect(source.liveMembers).toBe(0);
  });

  it('can start again after a stop (React’s development mode does that), with a fresh listener', () => {
    const source = fakeSettingsSource({ members: [ANNA] });
    const store = createPeopleStore(source);
    store.start();
    store.stop();
    store.start();
    expect(source.liveMembers).toBe(1);
    expect(store.getSnapshot().status).toBe('ready');
  });

  it('drops an answer or an error that arrives after stop, and says nothing about it', () => {
    let change: (members: readonly Member[]) => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    const source: Pick<SettingsSource, 'watchMembers'> = {
      watchMembers: (onChange, onError) => { change = onChange; fail = onError; return () => undefined; },
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createPeopleStore(source);
    store.start();
    store.stop();
    change([ANNA]);
    fail(Object.assign(new Error('Firestore shutting down'), { code: 'aborted' }));
    expect(store.getSnapshot()).toEqual({ status: 'loading', members: [] });
    expect(errors).not.toHaveBeenCalled();
  });

  it('says a failed stream, keeps what it showed, and writes only the error’s code to the console', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeSettingsSource({ members: [ANNA] });
    const store = createPeopleStore(source);
    store.start();
    source.breakMembers(Object.assign(new Error('Missing permission for anna@club.test anna1'), { code: 'permission-denied' }));
    expect(store.getSnapshot()).toEqual({ status: 'error', members: [ANNA] });
    expect(errors).toHaveBeenCalledWith('The people list stream failed:', 'permission-denied');
    const written = JSON.stringify(errors.mock.calls);
    expect(written).not.toContain('anna@club.test');
    expect(written).not.toContain('anna1');
  });
});
