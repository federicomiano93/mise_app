import { vi } from 'vitest';
import type { KioskOrdersSource, StoredDoc } from '../kiosk/kioskOrdersSource';

// The kiosk rest screen's reads (staff slice 6), from memory: each read is a spy, so a spec can count reads and make one fail.
export function fakeKioskOrdersSource(data: {
  config?: Readonly<Record<string, unknown>> | null;
  suppliers?: StoredDoc[];
  history?: StoredDoc[];
  draft?: Readonly<Record<string, unknown>> | null;
} = {}) {
  return {
    readConfig: vi.fn<KioskOrdersSource['readConfig']>(async () => data.config ?? null),
    readSuppliers: vi.fn<KioskOrdersSource['readSuppliers']>(async () => data.suppliers ?? []),
    readHistoryFrom: vi.fn<KioskOrdersSource['readHistoryFrom']>(async from => (data.history ?? []).filter(r => String(r.date) >= from)),
    readDraft: vi.fn<KioskOrdersSource['readDraft']>(async () => data.draft ?? null),
  };
}
