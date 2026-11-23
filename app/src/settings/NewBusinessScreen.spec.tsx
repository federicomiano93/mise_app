import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { joinLinkFor } from '@mise/shared/join-link';
import { hasUnsavedWork, isBusy } from '../session/busy';
import { FAKE_BUSINESS_ID, FAKE_LINK_TOKEN, fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';

// «New business» (the app's administrator only): who sees the row and the address, the empty start, the four checks that block and
// point at the first thing missing, the question before anything is created, the exact request for both kinds, the failures that keep
// what was typed, the customer's link shown once (and the question while it has not been copied), the business that is yours, and the
// question on leaving a form with something typed.

const MAYBE = 'The answer did not arrive: the business may already have been created. Before trying again, reload the app and see whether it is already among your venues.';
const main = () => within(screen.getByRole('main'));
const LINK = joinLinkFor(FAKE_LINK_TOKEN);
const ADMIN = { isAppAdmin: true };

let consoleCalls: unknown[][] = [];

beforeEach(() => {
  consoleCalls = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleCalls.push(args); });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(navigator, 'share');
});

async function open(options: NonNullable<Parameters<typeof renderApp>[1]> = {}, source: FakeSettingsSource = fakeSettingsSource()) {
  const view = renderApp('/settings/new-business', { ...options, session: { ...ADMIN, ...options.session }, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Nuova attività' : 'New business' });
  return { ...view, source };
}

const nameBox = () => screen.getByRole('textbox', { name: 'Name' });
const radio = (name: string) => screen.getByRole('radio', { name });
const checkbox = (name: string) => screen.getByRole('checkbox', { name });
const press = (user: UserEvent, name: string) => user.click(screen.getByRole('button', { name }));

type Answers = { name?: string; who?: 'self' | 'link'; country?: 'IT' | 'GB'; sections?: readonly string[] };
async function fill(user: UserEvent, { name = 'Rossi Bakery', who = 'link', country = 'GB', sections = ['Orders'] }: Answers = {}) {
  if (name) await user.type(nameBox(), name);
  if (who) await user.click(radio(who === 'self' ? 'Me, with this account' : 'Whoever opens the link'));
  if (country) await user.click(radio(country === 'IT' ? 'Italy' : 'United Kingdom'));
  for (const section of sections) await user.click(checkbox(section));
}

async function create(user: UserEvent) {
  await press(user, 'Create the business');
  const question = await screen.findByRole('alertdialog');
  await user.click(within(question).getByRole('button', { name: 'Create the business' }));
}

describe('who sees «New business»', () => {
  it('is a card of its own, the last on the page, for the app administrator', () => {
    renderApp('/settings', { session: ADMIN });
    const card = main().getByRole('heading', { level: 2, name: 'Businesses you run' }).closest('section') as HTMLElement;
    expect(within(card).getByText('Only you see this, as Mise’s administrator.')).toBeInTheDocument();
    const row = within(card).getByRole('link', { name: 'New business' });
    expect(row).toHaveAttribute('href', '/settings/new-business');
    expect(row).toHaveAccessibleDescription('Create a new venue: your own, or a customer’s with a sign-up link');
    const cards = main().getAllByRole('heading', { level: 2 });
    expect(cards[cards.length - 1]).toHaveTextContent('Businesses you run');
  });

  it('is in Italian for an Italian venue', () => {
    renderApp('/settings', { session: ADMIN, lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Le attività che gestisci' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Nuova attività' })).toBeInTheDocument();
    expect(main().getByText('Lo vedi solo tu, come amministratore di Mise.')).toBeInTheDocument();
  });

  it('is not drawn for an owner who is not an administrator', () => {
    renderApp('/settings', { session: { role: 'owner', isOwner: true, canManageVenue: true, isAppAdmin: false } });
    expect(main().queryByRole('heading', { name: 'Businesses you run' })).not.toBeInTheDocument();
    expect(main().queryByRole('link', { name: 'New business' })).not.toBeInTheDocument();
  });

  it('is not drawn for an employee either', () => {
    renderApp('/settings', { session: { role: 'staff', canManage: false, canManageVenue: false, isOwner: false } });
    expect(main().queryByRole('link', { name: 'New business' })).not.toBeInTheDocument();
  });

  it('sends anybody who is not an administrator back to the Settings page when its address is typed', async () => {
    const source = fakeSettingsSource();
    const { router } = renderApp('/settings/new-business', { session: { isAppAdmin: false }, data: { settings: () => source } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('opens from its row and Back hands the focus back to the row', async () => {
    const { user, router } = renderApp('/settings', { session: ADMIN });
    await user.click(main().getByRole('link', { name: 'New business' }));
    await screen.findByRole('heading', { level: 2, name: 'New business' });
    expect(router.state.location.pathname).toBe('/settings/new-business');
    await press(user, 'Back');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    await waitFor(() => { expect(main().getByRole('link', { name: 'New business' })).toHaveFocus(); });
  });
});

describe('the empty start', () => {
  it('has nothing typed, chosen or ticked, and says what each choice means', async () => {
    await open();
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('maxlength', '80');
    expect(nameBox()).toHaveAttribute('placeholder', 'Rossi Bakery');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    for (const one of screen.getAllByRole('radio')) expect(one).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    for (const one of screen.getAllByRole('checkbox')) expect(one).not.toBeChecked();
    expect(radio('Me, with this account')).toHaveAccessibleDescription('It opens in your account straight away, as owner. No link.');
    expect(radio('Whoever opens the link')).toHaveAccessibleDescription(
      'You get a link: whoever opens it signs up with their own email and becomes the owner.');
    expect(radio('Italy')).toHaveAccessibleDescription('Labels in Italian');
    expect(radio('United Kingdom')).toHaveAccessibleDescription('Labels in English');
    expect(screen.getByText('It decides the language of the allergen labels and cannot be changed later.')).toBeInTheDocument();
    expect(screen.getByText('It is created on the server straight away. The country cannot be changed later.')).toBeInTheDocument();
    for (const name of ['Orders', 'Calculator', 'Recipes', 'Pastries', 'Food cost']) expect(checkbox(name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create the business' })).toBeInTheDocument();
  });

  it('is in Italian with the words of the mockup', async () => {
    await open({ lang: 'it' });
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveAttribute('placeholder', 'Pasticceria Rossi');
    expect(screen.getByRole('radio', { name: 'Io, con questo account' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Chi apre il link' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Italia' })).toHaveAccessibleDescription('Etichette in italiano');
    expect(screen.getByRole('radio', { name: 'Regno Unito' })).toHaveAccessibleDescription('Etichette in inglese');
    expect(screen.getByRole('button', { name: 'Crea l’attività' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });

  it('marks nothing busy and leaves silently when nothing was touched', async () => {
    const { user, router } = await open();
    expect(isBusy()).toBe(false);
    await press(user, 'Back');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the checks before anything is asked of the server', () => {
  it('blocks an empty form and focuses the name, saying what is missing for every field', async () => {
    const { user, source } = await open();
    await press(user, 'Create the business');
    expect(nameBox()).toHaveFocus();
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(nameBox()).toHaveAccessibleDescription('Give the business a name.');
    expect(screen.getByText('Choose who gets in: you, or whoever opens the link.')).toBeInTheDocument();
    expect(screen.getByText('Choose the country. It decides the language of the labels.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one section, or its app opens empty.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('a name of spaces is no name', async () => {
    const { user, source } = await open();
    await fill(user, { name: '', who: 'self', country: 'IT', sections: ['Orders'] });
    await user.type(nameBox(), '   ');
    await press(user, 'Create the business');
    expect(nameBox()).toHaveFocus();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('with only the name missing the focus goes to it, and typing clears its message', async () => {
    const { user } = await open();
    await fill(user, { name: '', who: 'self', country: 'IT', sections: ['Orders'] });
    await press(user, 'Create the business');
    expect(nameBox()).toHaveFocus();
    await user.type(nameBox(), 'R');
    expect(screen.queryByText('Give the business a name.')).not.toBeInTheDocument();
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
  });

  it('with the name typed the focus goes to «Who gets in?» (the group, not its first radio)', async () => {
    const { user, source } = await open();
    await user.type(nameBox(), 'Rossi Bakery');
    await user.click(radio('United Kingdom'));
    await user.click(checkbox('Orders'));
    await press(user, 'Create the business');
    const group = screen.getByRole('radiogroup', { name: 'Who gets in?' });
    expect(group).toHaveFocus();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Choose who gets in: you, or whoever opens the link.')).toBeInTheDocument();
    expect(radio('Me, with this account')).not.toBeChecked();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('with the name and who typed the focus goes to the country, and nothing is chosen for the person', async () => {
    const { user, source } = await open();
    await user.type(nameBox(), 'Rossi Bakery');
    await user.click(radio('Whoever opens the link'));
    await user.click(checkbox('Orders'));
    await press(user, 'Create the business');
    const group = screen.getByRole('radiogroup', { name: 'Which country does it sell in?' });
    expect(group).toHaveFocus();
    expect(group).toHaveAccessibleDescription(expect.stringContaining('Choose the country.'));
    expect(radio('Italy')).not.toBeChecked();
    expect(radio('United Kingdom')).not.toBeChecked();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('with everything but a section the focus goes to the sections', async () => {
    const { user, source } = await open();
    await fill(user, { sections: [] });
    await press(user, 'Create the business');
    expect(screen.getByRole('group', { name: 'Which sections it uses' })).toHaveFocus();
    expect(screen.getByText('Choose at least one section, or its app opens empty.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('ticking a section clears its message', async () => {
    const { user } = await open();
    await fill(user, { sections: [] });
    await press(user, 'Create the business');
    await user.click(checkbox('Pastries'));
    expect(screen.queryByText('Choose at least one section, or its app opens empty.')).not.toBeInTheDocument();
  });
});

describe('the question before anything is created', () => {
  it('names the business and says what happens, for a customer\'s link', async () => {
    const { user, source } = await open();
    await fill(user, { name: '  Rossi Bakery ' });
    await press(user, 'Create the business');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Create “Rossi Bakery”?')).toBeInTheDocument();
    expect(within(question).getByText('You get a link for whoever will be the owner. It is shown only once.')).toBeInTheDocument();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('says it opens in your account, for one of your own', async () => {
    const { user } = await open();
    await fill(user, { who: 'self' });
    await press(user, 'Create the business');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('It opens in your account, as owner.')).toBeInTheDocument();
  });

  it('repeats the country and the sections, in the form\'s words and order', async () => {
    const { user } = await open();
    await fill(user, { country: 'IT', sections: ['Pastries', 'Orders', 'Calculator'] });
    await press(user, 'Create the business');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Country: Italy — it decides the label language and cannot be changed later.')).toBeInTheDocument();
    expect(within(question).getByText('Sections: Orders, Calculator, Pastries.')).toBeInTheDocument();
  });

  it('is in Italian', async () => {
    const { user } = await open({ lang: 'it' });
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Pasticceria Rossi');
    await user.click(screen.getByRole('radio', { name: 'Chi apre il link' }));
    await user.click(screen.getByRole('radio', { name: 'Italia' }));
    await user.click(screen.getByRole('checkbox', { name: 'Calcolatore' }));
    await user.click(screen.getByRole('checkbox', { name: 'Ordini' }));
    await user.click(screen.getByRole('button', { name: 'Crea l’attività' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Paese: Italia — decide la lingua delle etichette e non si cambia dopo.')).toBeInTheDocument();
    expect(within(question).getByText('Sezioni: Ordini, Calcolatore.')).toBeInTheDocument();
    expect(within(question).getByText('Creare “Pasticceria Rossi”?')).toBeInTheDocument();
    expect(within(question).getByText('Esce un link per chi sarà il titolare: si vede una volta sola.')).toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });

  it('Cancel creates nothing and keeps what was typed', async () => {
    const { user, source } = await open();
    await fill(user);
    await press(user, 'Create the business');
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.createBusiness).not.toHaveBeenCalled();
    expect(nameBox()).toHaveValue('Rossi Bakery');
    expect(radio('Whoever opens the link')).toBeChecked();
  });
});

describe('the request', () => {
  it('for a customer: the name trimmed, the country, exactly the sections ticked, and forSelf false', async () => {
    const { user, source } = await open();
    await fill(user, { name: ' Rossi Bakery ', who: 'link', country: 'IT', sections: ['Orders', 'Recipes', 'Food cost'] });
    await create(user);
    await screen.findByText('✓ Rossi Bakery has been created');
    expect(source.createBusiness).toHaveBeenCalledExactlyOnceWith({
      name: 'Rossi Bakery',
      country: 'IT',
      sections: { orders: true, calculator: false, catalogue: true, pastries: false, foodcost: true },
      forSelf: false,
    });
  });

  it('for one of your own: forSelf true, and the country of the Regno Unito choice', async () => {
    const { user, source } = await open();
    await fill(user, { name: 'Mine', who: 'self', country: 'GB', sections: ['Calculator', 'Pastries'] });
    await create(user);
    await screen.findByText('✓ Mine has been created and it is yours');
    expect(source.createBusiness).toHaveBeenCalledExactlyOnceWith({
      name: 'Mine',
      country: 'GB',
      sections: { orders: false, calculator: true, catalogue: false, pastries: true, foodcost: false },
      forSelf: true,
    });
  });

  it('is asked once, however many times the button is pressed while it is with the server', async () => {
    const source = fakeSettingsSource();
    source.holdBusiness = true;
    const { user } = await open({}, source);
    await fill(user);
    await create(user);
    await waitFor(() => { expect(source.createBusiness).toHaveBeenCalledTimes(1); });
    expect(hasUnsavedWork()).toBe(true);
    // The button is pending: a second press does nothing, and Cancel and Back are off.
    await user.click(screen.getByRole('button', { name: 'Create the business' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(source.createBusiness).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    source.answerBusiness();
    await screen.findByText('✓ Rossi Bakery has been created');
    expect(source.createBusiness).toHaveBeenCalledTimes(1);
  });
});

describe('a business that could not be made', () => {
  const refused = (code: string) => Object.assign(new Error('Server English that must never be shown'), { code });

  it.each([
    ['functions/permission-denied', 'Only Mise’s administrator can create a business.'],
    ['functions/invalid-argument', 'Nothing was created. Try again.'],
    ['functions/unauthenticated', 'Nothing was created. Try again.'],
    ['functions/unavailable', MAYBE],
    ['functions/deadline-exceeded', MAYBE],
    ['functions/internal', MAYBE],
    ['functions/unknown', MAYBE],
  ])('%s is said in the app\'s own words, and nothing typed is lost', async (code, sentence) => {
    const source = fakeSettingsSource();
    source.businessFailWith = refused(code);
    const { user } = await open({}, source);
    await fill(user, { name: 'Rossi Bakery', who: 'link', country: 'IT', sections: ['Orders', 'Pastries'] });
    await create(user);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByText(/Server English/)).not.toBeInTheDocument();
    expect(nameBox()).toHaveValue('Rossi Bakery');
    expect(radio('Whoever opens the link')).toBeChecked();
    expect(radio('Italy')).toBeChecked();
    expect(checkbox('Orders')).toBeChecked();
    expect(checkbox('Pastries')).toBeChecked();
    expect(checkbox('Calculator')).not.toBeChecked();
    // The button works again: a retry after the fault is gone makes the business.
    expect(screen.getByRole('button', { name: 'Create the business' })).toBeEnabled();
    source.businessFailWith = null;
    await create(user);
    await screen.findByText('✓ Rossi Bakery has been created');
    expect(source.createBusiness).toHaveBeenCalledTimes(2);
  });

  it('no console line carries the name or a link', async () => {
    const source = fakeSettingsSource();
    source.businessFailWith = refused('functions/internal');
    const { user } = await open({}, source);
    await fill(user, { name: 'Rossi Bakery' });
    await create(user);
    await screen.findByText(MAYBE);
    expect(JSON.stringify(consoleCalls)).not.toContain('Rossi');
  });
});

describe('a customer\'s link', () => {
  async function made(options: Parameters<typeof open>[0] = {}) {
    const view = await open(options);
    await fill(view.user, { name: 'Rossi Bakery', who: 'link', country: 'GB', sections: ['Orders'] });
    await create(view.user);
    await screen.findByText('✓ Rossi Bakery has been created');
    return view;
  }

  it('is shown as text, with what it is for and that it is shown only now', async () => {
    await made();
    expect(main().getByRole('heading', { level: 3, name: 'The sign-up link' })).toBeInTheDocument();
    expect(screen.getByText(LINK)).toBeInTheDocument();
    expect(screen.getByText(/Open it yourself, or send it to whoever will be the owner/)).toBeInTheDocument();
    expect(screen.getByText(/It needs an email that has no Mise account yet\./)).toBeInTheDocument();
    expect(screen.getByText('The link is shown only now.')).toBeInTheDocument();
    expect(screen.getByText(/It works once and expires in 7 days\. If you leave without copying it, the app asks first\./)).toBeInTheDocument();
    // The form is gone: nothing typed can be sent twice.
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('is in Italian', async () => {
    const { user } = await open({ lang: 'it' });
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Pasticceria Rossi');
    await user.click(screen.getByRole('radio', { name: 'Chi apre il link' }));
    await user.click(screen.getByRole('radio', { name: 'Italia' }));
    await user.click(screen.getByRole('checkbox', { name: 'Paste' }));
    await user.click(screen.getByRole('button', { name: 'Crea l’attività' }));
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Crea l’attività' }));
    await screen.findByText('✓ L’attività Pasticceria Rossi è stata creata');
    expect(screen.getByRole('heading', { level: 3, name: 'Il link per registrarsi' })).toBeInTheDocument();
    expect(screen.getByText('Il link si vede solo adesso.')).toBeInTheDocument();
    expect(screen.getByText(/Funziona una volta sola e scade fra 7 giorni\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copia il link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fatto' })).toBeInTheDocument();
  });

  it('takes the focus on its banner when it appears', async () => {
    await made();
    expect(screen.getByText('✓ Rossi Bakery has been created')).toHaveFocus();
  });

  it('Copy puts the link on the clipboard and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { user } = await made();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await press(user, 'Copy the link');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('The link is copied. Paste it into a message to them.')).toBeInTheDocument();
    // The link is still on the screen.
    expect(screen.getByText(LINK)).toBeInTheDocument();
  });

  it('a clipboard that refuses says to copy it by hand, and the link stays on the screen', async () => {
    const { user } = await made();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    await press(user, 'Copy the link');
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText(/Your phone would not copy it\. Copy this link by hand/)).toBeInTheDocument();
    expect(within(notice).getByText(LINK)).toBeInTheDocument();
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(screen.getByText(LINK)).toBeInTheDocument();
    // Nothing was copied, so leaving still asks.
    await press(user, 'Done');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('has no Share button where the device cannot share', async () => {
    await made();
    expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
  });

  it('has a Share button where the device can, handing over the name and the link', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const { user } = await made();
    await press(user, 'Share…');
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Rossi Bakery', text: `Here is your link to set up Rossi Bakery: ${LINK}` });
    // Shared: leaving is silent.
    await press(user, 'Done');
    await waitFor(() => { expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a share sheet closed without sending hands nothing over, so leaving still asks', async () => {
    const share = vi.fn(() => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const { user } = await made();
    await press(user, 'Share…');
    await press(user, 'Done');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('asks before leaving until the link has been copied: Stay keeps the link, Leave anyway goes', async () => {
    const { user, router } = await made();
    expect(hasUnsavedWork()).toBe(true);
    await press(user, 'Done');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('The link cannot be shown again. Leave anyway?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Stay' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/settings/new-business');
    expect(screen.getByText(LINK)).toBeInTheDocument();

    await press(user, 'Back');
    const again = await screen.findByRole('alertdialog');
    await user.click(within(again).getByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('is silent on the way out once the link has been copied, and the browser\'s own question has stopped too', async () => {
    const { user, router } = await made();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    await press(user, 'Copy the link');
    const notice = await screen.findByRole('alertdialog');
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(isBusy()).toBe(false);
    await press(user, 'Done');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('a business of your own', () => {
  async function made(options: Parameters<typeof open>[0] = {}) {
    const view = await open(options);
    await fill(view.user, { name: 'Mine', who: 'self', country: 'IT', sections: ['Orders'] });
    await create(view.user);
    await screen.findByText('✓ Mine has been created and it is yours');
    return view;
  }

  it('says it is yours and that there is no link to send, with no link anywhere', async () => {
    await made();
    expect(screen.getByText('You are the owner. There is no link to send.')).toBeInTheDocument();
    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the link' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Mine' })).toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  it('is in Italian', async () => {
    const { user } = await open({ lang: 'it' });
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Mia');
    await user.click(screen.getByRole('radio', { name: 'Io, con questo account' }));
    await user.click(screen.getByRole('radio', { name: 'Italia' }));
    await user.click(screen.getByRole('checkbox', { name: 'Ordini' }));
    await user.click(screen.getByRole('button', { name: 'Crea l’attività' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Si apre nel tuo account, come titolare.')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Crea l’attività' }));
    await screen.findByText('✓ L’attività Mia è stata creata ed è tua');
    expect(screen.getByText('Sei il titolare. Nessun link da mandare.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apri Mia' })).toBeInTheDocument();
  });

  it('Done goes back to Settings with no question', async () => {
    const { user, router } = await made();
    await press(user, 'Done');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Back goes with no question either', async () => {
    const { user, router } = await made();
    await press(user, 'Back');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Open moves to the new venue through the session\'s own way in, not its switch, and asks nothing when nothing is waiting', async () => {
    const { user, store } = await made();
    await press(user, 'Open Mine');
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledExactlyOnceWith(FAKE_BUSINESS_ID, 'u1'); });
    expect(store.switchLocation).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a second press of Open before the first has been answered does nothing', async () => {
    const { store } = await made();
    let answer: (waiting: boolean) => void = () => undefined;
    store.changesStillWaiting.mockReturnValueOnce(new Promise<boolean>(resolve => { answer = resolve; }));
    const button = screen.getByRole('button', { name: 'Open Mine' });
    fireEvent.click(button);
    fireEvent.click(button);
    answer(false);
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledTimes(1); });
    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
  });

  it('Open that fails says so beside the button, and the screen stays', async () => {
    const { user, store } = await made();
    store.openJoinedVenue.mockRejectedValueOnce(new Error('no'));
    await press(user, 'Open Mine');
    expect(await screen.findByText('That did not work. Check the connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Mine' })).toBeInTheDocument();
  });

  it('Open asks first when something typed elsewhere has not reached the server', async () => {
    const { user, store } = await made();
    store.changesStillWaiting.mockResolvedValueOnce(true);
    await press(user, 'Open Mine');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Not sent yet')).toBeInTheDocument();
    expect(store.openJoinedVenue).not.toHaveBeenCalled();
    await user.click(within(question).getByRole('button', { name: 'Go on anyway' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledExactlyOnceWith(FAKE_BUSINESS_ID, 'u1'); });
  });
});

describe('leaving a form with something typed or chosen', () => {
  it.each([
    ['a name', async (user: UserEvent) => { await user.type(nameBox(), 'R'); }],
    ['who gets in', async (user: UserEvent) => { await user.click(radio('Whoever opens the link')); }],
    ['a country', async (user: UserEvent) => { await user.click(radio('Italy')); }],
    ['a section', async (user: UserEvent) => { await user.click(checkbox('Orders')); }],
  ])('asks after %s, and the browser asks too', async (_what, touch) => {
    const { user, router } = await open();
    await touch(user);
    expect(hasUnsavedWork()).toBe(true);
    await press(user, 'Back');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Discard what you typed?')).toBeInTheDocument();
    expect(within(question).getByText('The business has not been created yet.')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/settings/new-business');

    await press(user, 'Back');
    const again = await screen.findByRole('alertdialog');
    await user.click(within(again).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('the Cancel button of the form asks the same, and the rail does too', async () => {
    const { user, router, source } = await open();
    await user.type(nameBox(), 'Rossi');
    await press(user, 'Cancel');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Discard what you typed?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(nameBox()).toHaveValue('Rossi');
    void router.navigate('/');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(source.createBusiness).not.toHaveBeenCalled();
  });

  it('a customer\'s link not yet copied asks on the rail too, and Stay keeps the link and gives the focus back to a real element', async () => {
    const { user, router } = await open();
    await fill(user);
    await create(user);
    await screen.findByText('✓ Rossi Bakery has been created');
    void router.navigate('/');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('The link cannot be shown again. Leave anyway?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Stay' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/settings/new-business');
    expect(screen.getByText(LINK)).toBeInTheDocument();
    await waitFor(() => { expect(document.activeElement).not.toBe(document.body); });
  });

  it.each([
    ['a customer\'s business', 'link' as const],
    ['one of your own', 'self' as const],
  ])('while the call for %s is in the air, leaving asks, and the browser asks too', async (_what, who) => {
    const source = fakeSettingsSource();
    source.holdBusiness = true;
    const { user, router } = await open({}, source);
    await fill(user, { who });
    await create(user);
    await waitFor(() => { expect(source.createBusiness).toHaveBeenCalledTimes(1); });
    expect(hasUnsavedWork()).toBe(true);
    void router.navigate('/');
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('The business is being created. Leave anyway?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Stay' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/settings/new-business');
    source.answerBusiness();
    await screen.findByText(who === 'link' ? '✓ Rossi Bakery has been created' : '✓ Rossi Bakery has been created and it is yours');
  });

  it('leaving anyway during the call lets the answer arrive with nothing to draw: no throw, nothing logged', async () => {
    const source = fakeSettingsSource();
    source.holdBusiness = true;
    const { user, router } = await open({}, source);
    await fill(user, { who: 'self' });
    await create(user);
    await waitFor(() => { expect(source.createBusiness).toHaveBeenCalledTimes(1); });
    void router.navigate('/');
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Leave anyway' }));
    // '/' redirects on to the Home at its own pace: on a slow runner the first look already sees '/home', so the test asks only
    // that the settings screen was left.
    await waitFor(() => { expect(router.state.location.pathname).not.toMatch(/^\/settings/); });
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument(); });
    source.answerBusiness();
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(consoleCalls).toEqual([]);
  });

  it('is in Italian', async () => {
    const { user } = await open({ lang: 'it' });
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'R');
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Scartare quello che hai scritto?')).toBeInTheDocument();
    expect(within(question).getByText('L’attività non è ancora stata creata.')).toBeInTheDocument();
  });
});

describe('opening your own business: the check', () => {
  async function madeOwn() {
    const view = await open();
    await fill(view.user, { name: 'Mine', who: 'self', country: 'IT', sections: ['Orders'] });
    await create(view.user);
    await screen.findByText('✓ Mine has been created and it is yours');
    return view;
  }

  it('says it is checking, on the button and in a status line, while the answer is out', async () => {
    const { user, store } = await madeOwn();
    store.changesStillWaiting.mockReturnValueOnce(new Promise<boolean>(() => undefined));

    await press(user, 'Open Mine');

    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeInTheDocument();
    expect(screen.getByText('Checking everything has reached the server…').closest('[role="status"]')).not.toBeNull();
  });

  it('Done during the check cancels it: a late «nothing waiting» opens nothing', async () => {
    const { user, store, router } = await madeOwn();
    let answer: (waiting: boolean) => void = () => undefined;
    store.changesStillWaiting.mockReturnValueOnce(new Promise<boolean>(resolve => { answer = resolve; }));
    await press(user, 'Open Mine');
    await screen.findByRole('button', { name: 'Checking…' });

    await press(user, 'Done');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    answer(false);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(store.openJoinedVenue).not.toHaveBeenCalled();
  });
});
