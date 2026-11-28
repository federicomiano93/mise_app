import { describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';

// The Home's pocket calculator: the card, the dialog, its keys and the keyboard. The sums themselves are pinned in shared/src/pocket-calc.spec.ts.

const UK = { location: { country: 'GB' } };
const IT = { language: 'it' as const, location: { country: 'IT', language: 'it' } };

const open = async (options: Parameters<typeof renderApp>[1] = {}) => {
  const view = renderApp('/home', options);
  await view.user.click(await screen.findByRole('button', { name: options.lang === 'it' ? 'Calcolatrice' : 'Calculator' }));
  const dialog = await screen.findByRole('dialog', { name: options.lang === 'it' ? 'Calcolatrice' : 'Calculator' });
  return { ...view, dialog };
};
const key = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name });
const result = (dialog: HTMLElement) => dialog.querySelector('[aria-live="polite"]') as HTMLElement;

describe('the Home’s calculator', () => {
  test('is a card on the Home only', async () => {
    renderApp('/home');
    expect(await screen.findByRole('button', { name: 'Calculator' })).toBeInTheDocument();
  });

  test('is not on another section', async () => {
    renderApp('/orders');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Calculator' })).not.toBeInTheDocument();
  });

  test('opens with a result of 0 in a live region and every key named', async () => {
    const { dialog } = await open();
    expect(result(dialog)).toHaveTextContent('0');
    expect(result(dialog)).toHaveAttribute('aria-live', 'polite');
    for (const name of ['Clear', 'Delete', 'Percent', 'Divided by', 'Times', 'Minus', 'Plus', 'Equals', 'Point', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(key(dialog, name)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  test('the keys build a sum and = solves it, the sum above the answer', async () => {
    const { dialog, user } = await open();
    for (const name of ['1', '2', 'Times', '3', 'Plus', '4', 'Equals']) await user.click(key(dialog, name));
    expect(result(dialog)).toHaveTextContent('40');
    expect(dialog).toHaveTextContent('12 × 3 + 4 =');
  });

  test('uses the point on a British venue and the comma on an Italian one', async () => {
    const uk = await open({ session: UK });
    for (const name of ['1', 'Point', '5', 'Plus', '2', 'Equals']) await uk.user.click(key(uk.dialog, name));
    expect(result(uk.dialog)).toHaveTextContent('3.5');
    expect(key(uk.dialog, 'Point')).toHaveTextContent('.');
  });

  test('in Italian: the comma, the words and «Errore» after a division by zero until Azzera', async () => {
    const { dialog, user } = await open({ lang: 'it', session: IT });
    for (const name of ['1', 'Virgola', '5', 'Più', '2', 'Uguale']) await user.click(key(dialog, name));
    expect(result(dialog)).toHaveTextContent('3,5');
    await user.click(key(dialog, 'Azzera'));
    for (const name of ['5', 'Diviso', '0', 'Uguale']) await user.click(key(dialog, name));
    expect(result(dialog)).toHaveTextContent('Errore');
    await user.click(key(dialog, '7'));
    expect(result(dialog)).toHaveTextContent('Errore');
    await user.click(key(dialog, 'Azzera'));
    expect(result(dialog)).toHaveTextContent('0');
    expect(key(dialog, 'Virgola')).toHaveTextContent(',');
  });

  test('percent works the phone way: 200 + 10 % = 220', async () => {
    const { dialog, user } = await open();
    for (const name of ['2', '0', '0', 'Plus', '1', '0', 'Percent', 'Equals']) await user.click(key(dialog, name));
    expect(result(dialog)).toHaveTextContent('220');
  });

  test('Delete takes the last digit', async () => {
    const { dialog, user } = await open();
    for (const name of ['1', '2', '3', 'Delete']) await user.click(key(dialog, name));
    expect(result(dialog)).toHaveTextContent('12');
  });

  test('the keyboard: digits, comma or point, + - * /, %, Enter, Backspace', async () => {
    const { dialog } = await open({ session: UK });
    const press = (k: string) => fireEvent.keyDown(document.body, { key: k });
    for (const k of ['1', '2', ',', '5', '*', '4']) press(k);
    expect(result(dialog)).toHaveTextContent('4');
    press('Enter');
    expect(result(dialog)).toHaveTextContent('50');
    press('Backspace');
    expect(result(dialog)).toHaveTextContent('50');
    press('9');
    press('/');
    press('3');
    press('=');
    expect(result(dialog)).toHaveTextContent('3');
    press('1');
    press('0');
    press('0');
    press('-');
    press('5');
    press('0');
    press('%');
    press('Enter');
    expect(result(dialog)).toHaveTextContent('50');
  });

  test('Enter on a focused key presses THAT key; «=» only when no key has the focus', async () => {
    const { dialog, user } = await open();
    await user.click(key(dialog, '7'));
    key(dialog, '7').focus();
    await user.keyboard('{Enter}');
    expect(result(dialog)).toHaveTextContent('77');
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '+' });
    fireEvent.keyDown(document.body, { key: '3' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(result(dialog)).toHaveTextContent('80');
  });

  test('the decimal key is named for the mark it shows, whatever the interface language («Punto» for a point, in Italian)', async () => {
    const it = await open({ lang: 'it', session: UK });
    expect(key(it.dialog, 'Punto')).toBeInTheDocument();
  });

  test('Enter on «Close» closes it and does not solve anything', async () => {
    const { dialog, user } = await open();
    await user.click(key(dialog, '7'));
    within(dialog).getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Calculator' })).not.toBeInTheDocument(); });
  });

  test('Escape and «Close» close it, and nothing is kept', async () => {
    const first = await open();
    await first.user.click(key(first.dialog, '9'));
    await first.user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Calculator' })).not.toBeInTheDocument(); });

    await first.user.click(screen.getByRole('button', { name: 'Calculator' }));
    const again = await screen.findByRole('dialog', { name: 'Calculator' });
    expect(result(again)).toHaveTextContent('0');
    await first.user.click(within(again).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Calculator' })).not.toBeInTheDocument(); });
  });
});
