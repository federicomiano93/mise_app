// «This device» (staff slice 5): kiosk mode for everybody, saved on the tap with «Saved ✓» into this device's `kiosk-mode`, a refused
// write said in a dialog with the control put back, in English and Italian.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { renderApp } from '../testing/renderApp';
import { SAVED_MS } from './DeviceCard';

const EMPLOYEE = { role: 'staff', canManage: false, canManageVenue: false, isOwner: false } as const;
const card = () => screen.getByRole('heading', { level: 2, name: /This device|Questo dispositivo/ }).closest('section') as HTMLElement;
const stored = () => localStorage.getItem(KIOSK_STORAGE_KEY);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('«This device»', () => {
  test('an employee sees it and can switch kiosk mode on: saved in this device, as the current app stores it', async () => {
    const { user } = renderApp('/settings', { session: EMPLOYEE });
    const here = within(card());
    const toggle = here.getByRole('switch', { name: 'Lab tablet' });
    expect(toggle).toHaveAccessibleDescription('Always open on this device; it dims when nobody uses it.');
    expect(toggle).not.toBeChecked();
    expect(here.queryByRole('radiogroup', { name: 'Dim after' }), 'the choices only once it is on').not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(stored()).toBe('{"enabled":true,"restMinutes":5,"nightHours":1}');
    expect(here.getByRole('status')).toHaveTextContent('Saved ✓');
    expect(here.getByRole('radiogroup', { name: 'Dim after' })).toBeInTheDocument();
    expect(here.getByRole('radiogroup', { name: 'Screen off after' })).toHaveAccessibleDescription('In the morning, wake it with the power button.');
    expect(here.getByText(/Android’s “Screen pinning”/)).toBeInTheDocument();
  });

  test('the choices: 2, 5, 10, 20 minutes and Never, 1, 2, 4 hours, the stored ones chosen; a tap saves', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":20,"nightHours":0}');
    const { user } = renderApp('/settings');
    const dim = within(within(card()).getByRole('radiogroup', { name: 'Dim after' }));
    const off = within(within(card()).getByRole('radiogroup', { name: 'Screen off after' }));
    expect(dim.getAllByRole('radio').map(b => b.textContent)).toEqual(['2 min', '5 min', '10 min', '20 min']);
    expect(off.getAllByRole('radio').map(b => b.textContent)).toEqual(['Never', '1 h', '2 h', '4 h']);
    expect(dim.getByRole('radio', { name: '20 min' })).toBeChecked();
    expect(off.getByRole('radio', { name: 'Never' })).toBeChecked();
    await user.click(dim.getByRole('radio', { name: '2 min' }));
    expect(stored()).toBe('{"enabled":true,"restMinutes":2,"nightHours":0}');
    await user.click(off.getByRole('radio', { name: '4 h' }));
    expect(stored()).toBe('{"enabled":true,"restMinutes":2,"nightHours":4}');
    expect(off.getByRole('radio', { name: '4 h' })).toBeChecked();
    expect(dim.getByRole('radio', { name: '2 min' })).toBeChecked();
  });

  test('switching it off keeps the minutes and hours for next time, and hides the choices', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":10,"nightHours":2}');
    const { user } = renderApp('/settings');
    await user.click(within(card()).getByRole('switch', { name: 'Lab tablet' }));
    expect(stored()).toBe('{"enabled":false,"restMinutes":10,"nightHours":2}');
    expect(within(card()).queryByRole('radiogroup', { name: 'Dim after' })).not.toBeInTheDocument();
  });

  test('«Saved ✓» shows for two seconds, on the card’s title line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp('/settings');
    const status = within(card()).getByRole('status');
    expect(status).toHaveTextContent('');
    expect(status.parentElement?.querySelector('h2')).not.toBeNull();
    await user.click(within(card()).getByRole('switch', { name: 'Lab tablet' }));
    expect(status).toHaveTextContent('Saved ✓');
    act(() => { vi.advanceTimersByTime(SAVED_MS); });
    expect(status).toHaveTextContent('');
  });

  test('a write the device refuses: the dialog says so, and the switch stays where it was', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const { user } = renderApp('/settings');
    const here = card();
    const toggle = within(here).getByRole('switch', { name: 'Lab tablet' });
    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This setting could not be saved on this device.');
    expect(toggle).not.toBeChecked();
    expect(within(here).getByRole('status', { hidden: true })).toHaveTextContent('');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('a refused choice is put back too', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":5,"nightHours":1}');
    const { user } = renderApp('/settings');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const dim = within(within(card()).getByRole('radiogroup', { name: 'Dim after' }));
    const five = dim.getByRole('radio', { name: '5 min' });
    const twenty = dim.getByRole('radio', { name: '20 min' });
    await user.click(twenty);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(five).toBeChecked();
    expect(twenty).not.toBeChecked();
  });

  test('speaks Italian, the current app’s words', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":5,"nightHours":1}');
    renderApp('/settings', { lang: 'it', session: { language: 'it' } });
    const here = within(card());
    expect(screen.getByRole('heading', { level: 2, name: 'Questo dispositivo' })).toBeInTheDocument();
    expect(here.getByRole('switch', { name: 'Tablet del laboratorio' })).toBeChecked();
    const off = within(here.getByRole('radiogroup', { name: 'Spegni lo schermo dopo' }));
    expect(off.getAllByRole('radio').map(b => b.textContent)).toEqual(['Mai', '1 ora', '2 ore', '4 ore']);
    expect(here.getByRole('radiogroup', { name: 'Oscura dopo' })).toBeInTheDocument();
    expect(here.getByText(/“Fissa schermata” di Android/)).toBeInTheDocument();
  });
});
