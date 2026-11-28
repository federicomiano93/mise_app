import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreFeedbackSource } from './feedbackSource';
import { FEEDBACK_MAX, SCREEN_MAX, VERSION_MAX, feedbackNote, screenFor } from './feedbackModel';

// The ONLY code in Mise 2 that writes a note to the real database. firestore.rules (`match /feedback/{id}`) accept exactly these keys,
// a server time, the signed-in uid, a screen of at most 40 characters and a version of at most 12 (or null): a slip here would first show as
// a refused note on a phone. tests/rules/firestore-rules-check.mjs holds the same payload against the real rules.

const SERVER_TIME = { sentinel: 'serverTimestamp' };

function fakeKit() {
  const fs = {
    collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
    serverTimestamp: () => SERVER_TIME,
    addDoc: vi.fn(async (..._args: unknown[]) => ({ id: 'x' })),
  };
  return { fs, kit: { fs, db: {} } as unknown as FirestoreKit };
}

describe('the feedback source', () => {
  test('adds one document under the venue with exactly the keys the rules allow', async () => {
    const { fs, kit } = fakeKit();
    const note = feedbackNote({ text: '  Make the font bigger  ', pathname: '/recipes/AbCdEfGhIjKlMnOpQrSt', appVersion: 'm2-abc1234' });
    expect(note).not.toBeNull();
    await createFirestoreFeedbackSource(() => Promise.resolve(kit), 'panificio-miano').send('u1', note!);

    expect(fs.addDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = fs.addDoc.mock.calls[0] as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe('locations/panificio-miano/feedback');
    expect(Object.keys(payload).sort()).toEqual(['appVersion', 'bakery', 'createdAt', 'screen', 'text', 'uid']);
    expect(payload).toEqual({
      bakery: 'panificio-miano',
      uid: 'u1',
      text: 'Make the font bigger',
      screen: 'recipes/AbCdEfGhIjKlMnOpQrSt',
      appVersion: 'm2-abc1234',
      createdAt: SERVER_TIME,
    });
  });

  test('a venue id that could point the write elsewhere throws', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreFeedbackSource(() => Promise.resolve(kit), '../users')).toThrow();
  });
});

describe('the note model', () => {
  test('nothing typed, or only spaces, is no note', () => {
    expect(feedbackNote({ text: '', pathname: '/home', appVersion: null })).toBeNull();
    expect(feedbackNote({ text: ' \n ', pathname: '/home', appVersion: null })).toBeNull();
  });

  test('the text is cut to 2000 characters', () => {
    expect(feedbackNote({ text: 'x'.repeat(FEEDBACK_MAX + 50), pathname: '/home', appVersion: null })?.text).toHaveLength(FEEDBACK_MAX);
  });

  test('the screen is the address without its slash, at most 40 characters', () => {
    expect(screenFor('/recipes/AbCdEfGhIjKlMnOpQrSt/edit')).toBe('recipes/AbCdEfGhIjKlMnOpQrSt/edit');
    expect(screenFor('/' + 'a'.repeat(100))).toHaveLength(SCREEN_MAX);
    expect(screenFor('/')).toBe('home');
    expect(screenFor('/orders/')).toBe('orders');
  });

  test('a version longer than 12 characters, or empty, is null', () => {
    expect(feedbackNote({ text: 'a', pathname: '/home', appVersion: 'x'.repeat(VERSION_MAX + 1) })?.appVersion).toBeNull();
    expect(feedbackNote({ text: 'a', pathname: '/home', appVersion: '' })?.appVersion).toBeNull();
    expect(feedbackNote({ text: 'a', pathname: '/home', appVersion: 'm2-abc1234' })?.appVersion).toBe('m2-abc1234');
  });
});
