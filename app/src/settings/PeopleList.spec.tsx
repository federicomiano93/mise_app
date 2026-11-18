import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '../session/session';
import { isBusy } from '../session/busy';
import { fakeSettingsSource, member } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';
import { ACTION_EVENT } from '../telemetry/usage';
import type { Member } from './settingsSource';

// The people list of «Who can get in» (staff slice 4): who sees it, the order, your own row with no buttons, change role / rename /
// remove each asking first and waiting for the server, refusals in the app's words, one call per tap, the busy marker, the focus, the
// listener's life, and that no email or uid ever reaches the console or a usage line.

// The signed-in owner of the fake session is uid 'u1' (testing/fakeSession.ts).
const ME = member('u1', { email: 'owner@club.test', firstName: 'Federico', lastName: 'Miano', role: 'owner' });
const CARLA = member('carla1', { email: 'carla@club.test', firstName: 'Carla', lastName: 'Bianchi', role: 'owner' });
const ANNA = member('anna1', { email: 'anna@club.test', firstName: 'Anna', lastName: 'Rossi', role: 'manager', title: 'head-chef' });
const BRUNO = member('bruno1', { email: 'bruno@club.test', firstName: 'Bruno', lastName: 'Verdi', role: 'staff' });
const NAMELESS = member('nn1', { email: '', role: 'staff' });
const TEAM: readonly Member[] = [BRUNO, ANNA, NAMELESS, ME, CARLA];

const ROLES: Readonly<Record<string, Partial<Session>>> = {
  'owner-sales': { role: 'owner-sales', canManage: true, canManageVenue: false, isOwner: false },
  'owner-kitchen': { role: 'owner-kitchen', canManage: true, canManageVenue: false, isOwner: false },
  manager: { role: 'manager', canManage: true, canManageVenue: true, isOwner: false },
  staff: { role: 'staff', canManage: false, canManageVenue: false, isOwner: false },
};

let consoleCalls: unknown[][] = [];
let actions: unknown[] = [];
const listen = (event: Event) => { actions.push((event as CustomEvent).detail); };

beforeEach(() => {
  consoleCalls = [];
  actions = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleCalls.push(args); });
  }
  window.addEventListener(ACTION_EVENT, listen);
});

afterEach(() => {
  window.removeEventListener(ACTION_EVENT, listen);
  vi.restoreAllMocks();
});

const refused = (code: string) => Object.assign(new Error('Server English that must never be shown'), { code });

async function open(
  { lang = 'en', members = TEAM, source = fakeSettingsSource({ members }) }:
  { lang?: 'en' | 'it'; members?: readonly Member[]; source?: FakeSettingsSource } = {},
) {
  const view = renderApp('/settings/people', { lang, data: { settings: () => source } });
  const region = await screen.findByRole('region', { name: lang === 'it' ? /^Chi ha già accesso/ : /^People with access/ });
  return { ...view, source, region };
}

const rows = (region: HTMLElement) => within(region).getAllByRole('listitem');
const rowOf = (region: HTMLElement, text: string) => rows(region).find(row => row.textContent?.includes(text)) as HTMLElement;
const alertdialog = () => screen.findByRole('alertdialog');

describe('who sees the list', () => {
  it.each(Object.keys(ROLES))('the role %s never sees it, and nothing is read for them', async role => {
    const source = fakeSettingsSource({ members: TEAM });
    const { router } = renderApp('/settings/people', { session: ROLES[role], data: { settings: () => source } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.queryByRole('region', { name: /People with access/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Anna Rossi')).not.toBeInTheDocument();
    expect(source.watchMembers).not.toHaveBeenCalled();
  });

  it('the full owner sees it under the invite card, as its own part', async () => {
    const { region } = await open();
    const card = screen.getByRole('heading', { level: 2, name: 'Who can get in' }).closest('section') as HTMLElement;
    expect(card).toContainElement(region);
    expect(within(card).getByRole('button', { name: 'Send a link' }).compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the rows', () => {
  it('counts everybody in the heading and puts the owners first, then by name, then everybody else', async () => {
    const { region } = await open();
    expect(within(region).getByRole('heading', { level: 3, name: 'People with access · 5' })).toBeInTheDocument();
    expect(rows(region).map(row => row.querySelector('span')?.textContent)).toEqual([
      'Carla Bianchi', 'Federico Miano · you', 'Anna Rossi', 'Bruno Verdi', '(no name yet)',
    ]);
  });

  it('shows each person’s name, role and email; a row with neither says so', async () => {
    const { region } = await open();
    const anna = rowOf(region, 'Anna Rossi');
    expect(within(anna).getByText('Head chef')).toBeInTheDocument();
    expect(within(anna).getByText('anna@club.test')).toBeInTheDocument();
    const nameless = rowOf(region, '(no name yet)');
    expect(within(nameless).getByText('Employee')).toBeInTheDocument();
    expect(within(nameless).getByText('(no email)')).toBeInTheDocument();
  });

  it('your own row has no buttons; every other row has the three, each named with the person', async () => {
    const { region } = await open();
    expect(within(rowOf(region, '· you')).queryAllByRole('button')).toHaveLength(0);
    const bruno = rowOf(region, 'Bruno Verdi');
    expect(within(bruno).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Change role of Bruno Verdi', 'Rename Bruno Verdi', 'Remove Bruno Verdi',
    ]);
    // The visible words are part of the name (axe label-content-name-mismatch).
    expect(within(bruno).getByRole('button', { name: 'Change role of Bruno Verdi' })).toHaveTextContent('Change role');
    // A row with no name is named by its email; with neither, by «(no name yet)».
    expect(within(rowOf(region, '(no name yet)')).getByRole('button', { name: 'Remove (no name yet)' })).toBeInTheDocument();
  });

  it('says «Nobody else yet.» when you are alone', async () => {
    const { region } = await open({ members: [ME] });
    expect(within(region).getByText('Nobody else yet.')).toBeInTheDocument();
  });

  it('follows the roster live', async () => {
    const { region, source } = await open({ members: [ME] });
    act(() => { source.members = [ME, BRUNO]; });
    expect(within(region).getByText('Bruno Verdi')).toBeInTheDocument();
    expect(within(region).queryByText('Nobody else yet.')).not.toBeInTheDocument();
  });

  it('says plainly when the roster cannot be read, and writes only the error’s code to the console', async () => {
    const { region, source } = await open();
    act(() => { source.breakMembers(refused('permission-denied')); });
    expect(within(region).getByRole('alert')).toHaveTextContent('Could not read who works here. Check your connection.');
    const written = JSON.stringify(consoleCalls);
    expect(written).toContain('permission-denied');
    expect(written).not.toMatch(/@club\.test|anna1|bruno1|carla1/);
  });

  it('holds ONE listener while on screen, and none once the screen is left', async () => {
    const { source, user } = await open();
    expect(source.liveMembers).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(source.liveMembers).toBe(0); });
  });
});

describe('change role', () => {
  it('shows the six choices with what each can do, the current one marked, the keyboard on it', async () => {
    const { region, user } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Change role of Anna Rossi' }));
    const picker = await screen.findByRole('dialog', { name: 'Role of Anna Rossi' });
    const choices = within(picker).getAllByRole('listitem').map(item => within(item).getByRole('button'));
    expect(choices).toHaveLength(6);
    expect(choices.map(choice => choice.querySelector('span > span')?.firstChild?.textContent)).toEqual([
      'Owner', 'Sales owner', 'Kitchen owner', 'Manager', 'Head chef', 'Employee',
    ]);
    const current = within(picker).getByRole('button', { name: /^Head chef/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveTextContent('Current');
    expect(current).toHaveFocus();
    expect(within(picker).getByText(/The same as Manager/)).toBeInTheDocument();
    expect(within(picker).getAllByText('Current')).toHaveLength(1);
  });

  it('a stray arrow key in the list chooses nothing', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Change role of Anna Rossi' }));
    await screen.findByRole('dialog', { name: 'Role of Anna Rossi' });
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{Home}{PageUp}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.setMemberRole).not.toHaveBeenCalled();
  });

  it('the current role changes nothing; Cancel neither; the keyboard goes back to the row', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Change role of Anna Rossi' });
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Head chef/ }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.setMemberRole).not.toHaveBeenCalled();
  });

  it('asks first, with the one sentence of what the new role can do; Cancel sends nothing', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Change role of Bruno Verdi' });
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Manager/ }));
    const question = await alertdialog();
    expect(question).toHaveAccessibleName('Make Bruno Verdi a manager?');
    expect(within(question).getByText('Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.')).toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Make manager' })).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(source.setMemberRole).not.toHaveBeenCalled();
  });

  it('on yes sends ONE call with the role and the title, shows the server’s answer, counts it by name, and gives the keyboard back', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Change role of Bruno Verdi' });
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Head chef/ }));
    // A double tap on the answer is one answer.
    await user.dblClick(within(await alertdialog()).getByRole('button', { name: 'Make head chef' }));
    await waitFor(() => { expect(within(rowOf(region, 'Bruno Verdi')).getByText('Head chef')).toBeInTheDocument(); });
    expect(source.setMemberRole).toHaveBeenCalledTimes(1);
    expect(source.setMemberRole).toHaveBeenCalledWith('bruno1', 'manager', 'head-chef');
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(actions).toEqual(['member-role-changed']);
    // The rows re-sort with the roster: Bruno is on the manager level now, before Anna by name.
    expect(rows(region).map(row => row.querySelector('span')?.textContent)).toEqual([
      'Carla Bianchi', 'Federico Miano · you', 'Anna Rossi', 'Bruno Verdi', '(no name yet)',
    ]);
  });

  it('asks the employee question in the danger style (taking power away)', async () => {
    const { region, user } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Change role of Anna Rossi' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Employee/ }));
    const question = await alertdialog();
    expect(question).toHaveAccessibleName('Make Anna Rossi an employee?');
    const ok = within(question).getByRole('button', { name: 'Make employee' });
    expect(ok.className).toMatch(/danger/);
  });

  it('the last owner: the server refuses and the app says it in its own words, the keyboard back on the row', async () => {
    const { region, user, source } = await open({ members: [ME, BRUNO, member('lone', { firstName: 'Lia', role: 'owner' })] });
    // The server counts the owners itself and refuses (failed-precondition) — here told to, as it does for the last owner.
    source.memberFailWith = refused('functions/failed-precondition');
    const button = within(rowOf(region, 'Lia')).getByRole('button', { name: 'Change role of Lia' });
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Employee/ }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Make employee' }));
    const notice = await screen.findByRole('alertdialog', { name: 'This is the only owner. Make somebody else an owner first.' });
    expect(within(notice).queryByText('Server English that must never be shown')).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(within(rowOf(region, 'Lia')).getByText('Owner')).toBeInTheDocument();
    expect(actions).toEqual([]);
  });
});

describe('refusals, in the app’s own words', () => {
  const CASES = [
    ['functions/permission-denied', 'Only the owner can do that.', 'Only the owner can do that.', 'Only the owner can do that.'],
    ['functions/not-found', 'That person is no longer in this location.', 'That person is no longer in this location.', 'That person is no longer in this location.'],
    ['functions/unavailable', 'Could not change that. Check your connection and try again.', 'Could not save that name. Check your connection.', 'Could not remove them. Check your connection and try again.'],
    ['functions/deadline-exceeded', 'Could not change that. Check your connection and try again.', 'Could not save that name. Check your connection.', 'Could not remove them. Check your connection and try again.'],
    ['functions/internal', 'That did not go through. Try again in a moment.', 'That did not go through. Try again in a moment.', 'That did not go through. Try again in a moment.'],
  ] as const;

  it.each(CASES)('%s, changing a role', async (code, sentence) => {
    const { region, user, source } = await open();
    source.memberFailWith = refused(code);
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Change role of Bruno Verdi' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Manager/ }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Make manager' }));
    expect(await screen.findByRole('alertdialog', { name: sentence })).toBeInTheDocument();
  });

  it.each(CASES)('%s, renaming: said in the form, the typing kept', async (code, _role, sentence) => {
    const { region, user, source } = await open();
    source.memberFailWith = refused(code);
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Rename Bruno Verdi' }));
    const form = await screen.findByRole('dialog', { name: 'Rename Bruno Verdi' });
    await user.clear(within(form).getByLabelText('First name'));
    await user.type(within(form).getByLabelText('First name'), 'Brunetto');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(within(form).getByRole('alert')).toHaveTextContent(sentence); });
    expect(within(form).getByLabelText('First name')).toHaveValue('Brunetto');
    expect(within(form).getByLabelText('First name')).toHaveFocus();
    expect(within(region).getByText('Bruno Verdi')).toBeInTheDocument();
  });

  it.each(CASES)('%s, removing', async (code, _role, _name, sentence) => {
    const { region, user, source } = await open();
    source.memberFailWith = refused(code);
    const button = within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Remove Bruno Verdi' });
    await user.click(button);
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    const notice = await screen.findByRole('alertdialog', { name: sentence });
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(within(region).getByText('Bruno Verdi')).toBeInTheDocument();
  });

  it('a phone that knows it is offline is told to check the connection, whatever code the SDK gave', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { region, user, source } = await open();
    source.memberFailWith = refused('functions/internal');
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Remove Bruno Verdi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alertdialog', { name: 'Could not remove them. Check your connection and try again.' })).toBeInTheDocument();
  });

  it('a refusal is never swallowed into the console only: it is on screen, and the console has its code alone', async () => {
    const { region, user, source } = await open();
    source.memberFailWith = refused('functions/permission-denied');
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Remove Anna Rossi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alertdialog', { name: 'Only the owner can do that.' })).toBeInTheDocument();
    expect(consoleCalls).toEqual([['A change in the people list failed:', 'functions/permission-denied']]);
  });
});

describe('rename', () => {
  it('opens on a copy of the names, the keyboard in the first box; nothing changes until Save', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' }));
    const form = await screen.findByRole('dialog', { name: 'Rename Anna Rossi' });
    const first = within(form).getByLabelText('First name');
    expect(first).toHaveValue('Anna');
    expect(within(form).getByLabelText('Surname')).toHaveValue('Rossi');
    expect(first).toHaveFocus();
    await user.type(first, 'lisa');
    expect(within(region).getByText('Anna Rossi')).toBeInTheDocument();
    expect(source.setMemberName).not.toHaveBeenCalled();
  });

  it('an empty box blocks Save: it is outlined, the reason is under it, the keyboard goes there, nothing is sent', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' }));
    const form = await screen.findByRole('dialog', { name: 'Rename Anna Rossi' });
    const first = within(form).getByLabelText('First name');
    const last = within(form).getByLabelText('Surname');
    await user.clear(last);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(last).toHaveAttribute('aria-invalid', 'true');
    expect(last).toHaveAccessibleDescription('Enter the surname.');
    expect(last).toHaveFocus();
    await user.clear(first);
    await user.type(last, 'Rossi');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(first).toHaveAccessibleDescription('Enter the first name.');
    expect(first).toHaveFocus();
    await user.type(first, '---');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(first).toHaveAccessibleDescription('That first name needs letters in it.');
    expect(source.setMemberName).not.toHaveBeenCalled();
  });

  it('Save sends ONE call with the tidied names, however often it is tapped; the dialog closes and the keyboard is back on Rename', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' });
    await user.click(button);
    const form = await screen.findByRole('dialog', { name: 'Rename Anna Rossi' });
    await user.clear(within(form).getByLabelText('First name'));
    await user.type(within(form).getByLabelText('First name'), '  Anna   Maria ');
    await user.dblClick(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(source.setMemberName).toHaveBeenCalledTimes(1);
    expect(source.setMemberName).toHaveBeenCalledWith('anna1', 'Anna Maria', 'Rossi');
    expect(within(region).getByText('Anna Maria Rossi')).toBeInTheDocument();
    await waitFor(() => { expect(within(rowOf(region, 'Anna Maria Rossi')).getByRole('button', { name: 'Rename Anna Maria Rossi' })).toHaveFocus(); });
    expect(actions).toEqual(['member-renamed']);
  });

  it('Enter in a box saves', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Rename Bruno Verdi' }));
    const form = await screen.findByRole('dialog', { name: 'Rename Bruno Verdi' });
    await user.type(within(form).getByLabelText('Surname'), 'ni{Enter}');
    await waitFor(() => { expect(source.setMemberName).toHaveBeenCalledWith('bruno1', 'Bruno', 'Verdini'); });
  });

  it('Save with nothing changed sends nothing and closes', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(source.setMemberName).not.toHaveBeenCalled();
  });

  it('Cancel with typing asks «Discard changes?»; «Cancel» there keeps the typing, «Discard» throws it away', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' });
    await user.click(button);
    const form = await screen.findByRole('dialog', { name: 'Rename Anna Rossi' });
    await user.type(within(form).getByLabelText('First name'), 'x');
    expect(isBusy()).toBe(true);
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(within(form).getByLabelText('First name')).toHaveValue('Annax');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(isBusy()).toBe(false);
    expect(source.setMemberName).not.toHaveBeenCalled();
  });

  it('leaving the screen with typing asks first', async () => {
    const { region, user, router } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' }));
    const form = await screen.findByRole('dialog', { name: 'Rename Anna Rossi' });
    await user.type(within(form).getByLabelText('First name'), 'x');
    await act(async () => { await router.navigate('/home'); });
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/people');
  });
});

describe('remove', () => {
  it('asks first, in the danger style, naming the person and their email and saying their phones stop getting notifications', async () => {
    const { region, user, source } = await open();
    const button = within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Remove Anna Rossi' });
    await user.click(button);
    const question = await alertdialog();
    expect(question).toHaveAccessibleName('Remove this person?');
    expect(question).toHaveAccessibleDescription(/^Anna Rossi \(anna@club\.test\) will lose access to this location immediately, and their phones stop getting its notifications\./);
    expect(within(question).getByRole('button', { name: 'Remove' }).className).toMatch(/danger/);
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(button).toHaveFocus(); });
    expect(source.setMemberRole).not.toHaveBeenCalled();
  });

  it('on yes sends ONE removal; the row goes with the roster, and the keyboard goes to the list’s heading', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Remove Anna Rossi' }));
    await user.dblClick(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(within(region).queryByText('Anna Rossi')).not.toBeInTheDocument(); });
    expect(source.setMemberRole).toHaveBeenCalledTimes(1);
    expect(source.setMemberRole).toHaveBeenCalledWith('anna1', null, null);
    await waitFor(() => { expect(within(region).getByRole('heading', { level: 3 })).toHaveFocus(); });
    expect(within(region).getByRole('heading', { level: 3 })).toHaveTextContent('People with access · 4');
    expect(actions).toEqual(['member-removed']);
  });

  it('a row with no name or email is asked about in the current app’s words', async () => {
    const { region, user } = await open();
    await user.click(within(rowOf(region, '(no name yet)')).getByRole('button', { name: 'Remove (no name yet)' }));
    expect(await alertdialog()).toHaveAccessibleDescription(/^\(no name yet\) \(no email\) will lose access/);
  });
});

describe('one change at a time', () => {
  it('while a change is with the server: «Saving…», the busy marker, and every other button does nothing', async () => {
    const source = fakeSettingsSource({ members: TEAM });
    let answer: () => void = () => undefined;
    source.setMemberRole = vi.fn(() => new Promise<void>(done => { answer = done; }));
    const { region, user } = await open({ source });
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Remove Bruno Verdi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(within(region).getByRole('status')).toHaveTextContent('Saving…'); });
    expect(isBusy()).toBe(true);

    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Remove Anna Rossi' }));
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Change role of Anna Rossi' }));
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rename Anna Rossi' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source.setMemberRole).toHaveBeenCalledTimes(1);

    await act(async () => { answer(); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(within(region).getByRole('status')).toHaveTextContent('');
  });

  it('leaving while a change is in the air lets go of the busy marker and says nothing afterwards', async () => {
    const source = fakeSettingsSource({ members: TEAM });
    let fail: (err: unknown) => void = () => undefined;
    source.setMemberRole = vi.fn(() => new Promise<void>((_done, reject) => { fail = reject; }));
    const { region, user } = await open({ source });
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Remove Bruno Verdi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
    await act(async () => { fail(refused('functions/unavailable')); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('privacy', () => {
  it('no email or uid reaches the console or a usage line, through every change and refusal', async () => {
    const { region, user, source } = await open();
    await user.click(within(rowOf(region, 'Bruno Verdi')).getByRole('button', { name: 'Change role of Bruno Verdi' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Manager/ }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Make manager' }));
    await waitFor(() => { expect(actions).toHaveLength(1); });
    source.memberFailWith = Object.assign(new Error('anna@club.test anna1'), { code: 'functions/internal' });
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Remove Anna Rossi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Remove' }));
    await screen.findByRole('alertdialog', { name: 'That did not go through. Try again in a moment.' });
    const written = JSON.stringify([consoleCalls, actions]);
    expect(written).not.toMatch(/@club\.test|anna1|bruno1|carla1|u1\b|Rossi|Verdi/);
    expect(actions).toEqual(['member-role-changed']);
  });
});

describe('in Italian', () => {
  it('names the list, the rows and the buttons in the current app’s words', async () => {
    const { region, user } = await open({ lang: 'it' });
    expect(within(region).getByRole('heading', { level: 3, name: 'Chi ha già accesso · 5' })).toBeInTheDocument();
    expect(within(rowOf(region, 'Federico Miano')).getByText('Federico Miano · tu')).toBeInTheDocument();
    const anna = rowOf(region, 'Anna Rossi');
    expect(within(anna).getByText('Chef di cucina')).toBeInTheDocument();
    expect(within(rowOf(region, '(ancora senza nome)')).getByText('(nessuna email)')).toBeInTheDocument();
    expect(within(anna).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Cambia ruolo di Anna Rossi', 'Rinomina Anna Rossi', 'Rimuovi Anna Rossi',
    ]);
    await user.click(within(anna).getByRole('button', { name: 'Cambia ruolo di Anna Rossi' }));
    const picker = await screen.findByRole('dialog', { name: 'Ruolo di Anna Rossi' });
    expect(within(picker).getByText('Attuale')).toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: /^Titolare cucina/ }));
    const question = await alertdialog();
    expect(question).toHaveAccessibleName('Rendere Anna Rossi titolare cucina?');
    expect(within(question).getByRole('button', { name: 'Rendi titolare cucina' })).toBeInTheDocument();
  });

  it('says the last owner in Italian', async () => {
    const { region, user, source } = await open({ lang: 'it' });
    source.memberFailWith = refused('functions/failed-precondition');
    await user.click(within(rowOf(region, 'Carla Bianchi')).getByRole('button', { name: 'Rimuovi Carla Bianchi' }));
    await user.click(within(await alertdialog()).getByRole('button', { name: 'Rimuovi' }));
    expect(await screen.findByRole('alertdialog', { name: 'È l’unico titolare. Prima rendi titolare qualcun altro.' })).toBeInTheDocument();
  });

  it('checks the rename boxes in Italian', async () => {
    const { region, user } = await open({ lang: 'it' });
    await user.click(within(rowOf(region, 'Anna Rossi')).getByRole('button', { name: 'Rinomina Anna Rossi' }));
    const form = await screen.findByRole('dialog', { name: 'Rinomina Anna Rossi' });
    await user.clear(within(form).getByLabelText('Nome'));
    await user.click(within(form).getByRole('button', { name: 'Salva' }));
    expect(within(form).getByLabelText('Nome')).toHaveAccessibleDescription('Inserisci il nome.');
  });
});
