import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The hub of the Calculator's Settings: its doors, and the two switches of the whole venue, which save on the tap.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const ordersSwitch = () => main().getByRole('switch', { name: 'Show the Orders button' });
const askDaySwitch = () => main().getByRole('switch', { name: 'Ask which day the dough is for' });
const alertNamed = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
// The «Saved ✓» tag: the status beside the heading of the first card.
const tag = () => main().getByRole('heading', { name: 'Clients and orders' }).nextElementSibling as HTMLElement;

async function hub(source = fakeCalculatorSource({ config: configOf() }), lang: 'en' | 'it' = 'en') {
  const view = renderCalculator('/calculator/settings', { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return { ...view, source };
}

describe('the hub', () => {
  it('has a door for Clients, WhatsApp, Client ordering, Recipes, Extra dough, Divisor and Dough history, each with what it is for', async () => {
    await hub();
    const doors = main().getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent);
    expect(doors).toEqual([
      'Back',
      'ClientsClients and the products each one orders',
      'WhatsAppBuild order lists: pick clients and the products to send',
      'Client orderingWhen orders sent from a client’s own link close',
      'RecipesAdd, edit or delete recipes; pick which show as tabs',
      'Extra doughShow or hide the extra-dough box in each recipe',
      'DivisorChoose which products the divisor box splits, per recipe',
      'Dough historyChoose which recipes show in the dough history, and for how long',
    ]);
  });

  it('has the Client ordering row, which opens the deadline editor', async () => {
    const { user, router } = await hub();
    await user.click(main().getByRole('button', { name: /^Client ordering/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/calculator/settings/ordering'); });
  });

  it('groups the rows under three headings', async () => {
    await hub();
    expect(main().getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Clients and orders', 'Recipes', 'Dough history']);
  });

  it('opens Extra dough, Divisor and Dough history one level down', async () => {
    const { user, router } = await hub();
    await user.click(main().getByRole('button', { name: /^Extra dough/ }));
    expect(router.state.location.pathname).toBe('/calculator/settings/extra');
    await user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await user.click(await main().findByRole('button', { name: /^Divisor/ }, LOAD));
    expect(router.state.location.pathname).toBe('/calculator/settings/divisor');
    await user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await user.click(await main().findByRole('button', { name: /^Dough history/ }, LOAD));
    expect(router.state.location.pathname).toBe('/calculator/settings/log');
  });

  it('speaks Italian', async () => {
    await hub(fakeCalculatorSource({ config: configOf() }), 'it');
    expect(main().getByRole('heading', { level: 2, name: 'Impostazioni' })).toBeInTheDocument();
    expect(main().getByRole('switch', { name: 'Mostra il pulsante Ordini' })).toBeInTheDocument();
    expect(main().getByRole('switch', { name: 'Chiedi per quale giorno è l’impasto' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^Storico impasti/ })).toBeInTheDocument();
  });
});

describe('the two switches of the whole venue', () => {
  it('start on, and are named by the words beside them and described by the line under', async () => {
    await hub();
    expect(ordersSwitch()).toBeChecked();
    expect(askDaySwitch()).toBeChecked();
    expect(ordersSwitch()).toHaveAccessibleDescription('The button at the bottom that opens the orders your clients sent.');
    expect(askDaySwitch()).toHaveAccessibleDescription('When off, Confirm saves the dough for today without asking.');
  });

  it('read the venue\'s own answer: a literal false is off, anything else on', async () => {
    await hub(fakeCalculatorSource({ config: configOf({ showClientOrdersButton: false }) }));
    expect(ordersSwitch()).not.toBeChecked();
    expect(askDaySwitch()).toBeChecked();
  });

  it('save on the tap, no question asked: only the one key changes, and the model number is this build\'s', async () => {
    const { user, source } = await hub();
    await user.click(ordersSwitch());
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]).toMatchObject({ showClientOrdersButton: false, askDoughDay: true, configModel: 4 });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(ordersSwitch()).not.toBeChecked();

    await user.click(askDaySwitch());
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(2); });
    expect(source.savedConfigs[1]).toMatchObject({ showClientOrdersButton: false, askDoughDay: false });
  });

  it('say «Saved ✓» for two seconds when the database was told, in a status that was there before it spoke', async () => {
    const { user } = await hub();
    const status = tag();
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toBeEmptyDOMElement();
    await user.click(askDaySwitch());
    await waitFor(() => { expect(status).toHaveTextContent('Saved ✓'); });
    await waitFor(() => { expect(status).toBeEmptyDOMElement(); }, { timeout: 4000 });
  }, 10_000);

  it('ignore a second tap while the first is travelling', async () => {
    const { user, source } = await hub();
    source.holdConfigSaves();
    await user.click(ordersSwitch());
    await user.click(ordersSwitch());
    expect(source.savedConfigs).toHaveLength(1);
    source.settleConfigSaves();
    await waitFor(() => { expect(tag()).toHaveTextContent('Saved ✓'); });
    expect(source.savedConfigs).toHaveLength(1);
  });

  it('a refused write puts the switch back, says why in a dialog, and shows no «Saved ✓»', async () => {
    const { user, source } = await hub();
    source.refuse.configSave = true;
    await user.click(ordersSwitch());
    const dialog = await alertNamed('Not saved: this app is out of date. Reload it and try again.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(ordersSwitch()).toBeChecked();
    expect(tag()).toBeEmptyDOMElement();
  });

  it('a write that fails for any other reason says «check the connection»', async () => {
    const { user, source } = await hub();
    source.saveConfig = () => Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await user.click(askDaySwitch());
    const dialog = await alertNamed('Not saved: check the connection and try again.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(askDaySwitch()).toBeChecked(); });
  });

  // Nothing leaves the phone before the database has answered once (js/calculator-config-store.js).
  it('before the server has answered, the switch is disabled: a tap changes nothing and sends nothing', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    const { user } = await hub(source);
    expect(askDaySwitch()).toBeDisabled();
    await user.click(askDaySwitch());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(askDaySwitch()).toBeChecked();
    expect(tag()).toBeEmptyDOMElement();
    expect(source.savedConfigs).toEqual([]);
  });

  it('say the refusal in Italian', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const { user } = await hub(source, 'it');
    source.refuse.configSave = true;
    await user.click(main().getByRole('switch', { name: 'Mostra il pulsante Ordini' }));
    await alertNamed('Non salvato: l’app su questo dispositivo è da aggiornare. Ricaricala e riprova.');
  });
});
