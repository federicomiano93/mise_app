import type { FeedbackNote } from '../feedback/feedbackModel';
import type { FeedbackSource } from '../feedback/feedbackSource';

// A feedback source for the specs: every note sent is kept, and a send can be refused, kept in the air (as an offline write is) or let through.
export type FakeFeedbackSource = FeedbackSource & {
  readonly sent: { uid: string; note: FeedbackNote }[];
  // 'ok' settles at once; 'refuse' rejects as the rules would; 'hang' never settles, as a write made offline.
  mode: 'ok' | 'refuse' | 'hang';
};

export function fakeFeedbackSource(): FakeFeedbackSource {
  const sent: { uid: string; note: FeedbackNote }[] = [];
  const source: FakeFeedbackSource = {
    sent,
    mode: 'ok',
    send(uid, note) {
      sent.push({ uid, note });
      if (source.mode === 'refuse') return Promise.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
      if (source.mode === 'hang') return new Promise<void>(() => undefined);
      return Promise.resolve();
    },
  };
  return source;
}
