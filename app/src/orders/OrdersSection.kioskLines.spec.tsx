// While Orders is open its store answers the kiosk's rest screen from its live data (staff slice 6, kiosk/liveOrdersLines.ts); once
// it closes, the rest screen reads for itself again.

import { describe, expect, test } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { liveKioskLines, liveKioskLinesShown } from '../kiosk/liveOrdersLines';
import { renderOrders } from '../testing/renderOrders';

describe('Orders answers the kiosk while it is open', () => {
  test('registered on opening, with no lines until its data has arrived; gone on closing', async () => {
    expect(liveKioskLinesShown()).toBe(false);
    renderOrders('/orders');
    // The section is loaded lazily: its store registers once it is drawn.
    await waitFor(() => { expect(liveKioskLinesShown()).toBe(true); });
    expect(Array.isArray(liveKioskLines())).toBe(true);
    cleanup();
    expect(liveKioskLinesShown()).toBe(false);
    expect(liveKioskLines()).toBeNull();
  });
});
