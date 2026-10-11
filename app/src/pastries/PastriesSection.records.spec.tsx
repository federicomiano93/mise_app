import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { StoredDoc } from './pastriesSource';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import type { FakePastriesSource } from '../testing/fakePastriesSource';
import { freezeClock, logDoc, renderPastries } from '../testing/renderPastries';

// Records: what was put to prove, night by night. The clock is Wednesday 14 October 2026, 21:00, so
// tonight's work date is 2026-10-14 and the last fifteen days begin on 2026-09-29.

beforeAll(async () => { await import('./PastriesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
const dialog = (name: string) => screen.findByRole('alertdialog', { name });
const region = () => document.querySelector('[role="status"][class*="region"]') as HTMLElement;
const card = () => screen.getByRole('region', { name: /^(Records|Registri)$/ });
const cards = () => within(card()).getAllByRole('listitem');
const dates = () => within(card()).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);

const withNote = (doc: StoredDoc, note: string): StoredDoc => ({ ...doc, note });

function seeded(): FakePastriesSource {
  return fakePastriesSource({
    logs: [
      withNote(logDoc('Thursday', [['Cornetti', 24], ['Krapfen', 12]], '2026-10-14'), 'Butter was low.\nUsed the old dough.'),
      logDoc('Friday', [['Brioche', 6]], '2026-10-14'),
      logDoc('Wednesday', [], '2026-10-13'),
      logDoc('Monday', [['Sfogliatelle', 4]], '2026-09-29'),
      logDoc('Sunday', [['Too old', 9]], '2026-09-28'),
    ],
  });
}

async function open(source: FakePastriesSource = seeded(), lang: 'en' | 'it' = 'en') {
  const view = renderPastries('/pastries/records', { source, lang });
  await screen.findByRole('heading', { level: 2, name: lang === 'it' ? 'Registri' : 'Records' }, LOAD);
  return view;
}

describe('Records: what it shows', () => {
  it('shows the last fifteen days, newest first, and two on one date in the order of the week', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(dates()).toEqual(['Wed 14 Oct', 'Wed 14 Oct', 'Tue 13 Oct', 'Tue 29 Sep']);
    expect(within(cards()[0] as HTMLElement).getByText('Thursday')).toBeInTheDocument();
    expect(within(cards()[1] as HTMLElement).getByText('Friday')).toBeInTheDocument();
  });

  it('leaves out a record older than fifteen days, and keeps the one that is exactly fifteen', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(screen.queryByText('Too old')).not.toBeInTheDocument();
    expect(within(cards()[3] as HTMLElement).getByText('Sfogliatelle')).toBeInTheDocument();
  });

  it('draws a record as the date, the list it was, the rows, and the note as it was that night', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    const first = within(cards()[0] as HTMLElement);
    expect(first.getByRole('heading', { level: 3, name: 'Wed 14 Oct' })).toBeInTheDocument();
    expect(first.getByText('Thursday')).toBeInTheDocument();
    expect(first.getByText('Cornetti').closest('div')).toHaveTextContent('Cornetti24');
    expect(first.getByText('Krapfen').closest('div')).toHaveTextContent('Krapfen12');
    const note = first.getByText(/Butter was low\./);
    expect(note.textContent).toBe('Butter was low.\nUsed the old dough.');
  });

  it('keeps a note\'s line breaks in the stylesheet too', async () => {
    const css = Object.values(import.meta.glob<string>('./Records.module.css', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
    expect(css).toMatch(/\.note\s*\{[^}]*white-space:\s*pre-line/);
    expect(css).toMatch(/\.qty\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('says «Nothing was proved.» for a record with no rows, and shows no note block for one with none', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    const empty = within(cards()[2] as HTMLElement);
    expect(empty.getByText('Nothing was proved.')).toBeInTheDocument();
    expect(empty.queryByText(/./, { selector: '[class*="note"]' })).not.toBeInTheDocument();
    expect(within(cards()[0] as HTMLElement).queryByText('Nothing was proved.')).not.toBeInTheDocument();
  });

  it('has the title, «Last 15 days», and the line saying older records are kept', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(screen.getByRole('heading', { level: 2, name: 'Records' })).toBeInTheDocument();
    expect(within(card()).getByText('Last 15 days')).toBeInTheDocument();
    expect(within(card()).getByText('Older records are kept — this screen shows the last 15 days.')).toBeInTheDocument();
  });

  it('says so when there are none, and points at Confirm — and has no «older records» line', async () => {
    await open(fakePastriesSource());
    expect(await within(card()).findByText('No records yet.')).toBeInTheDocument();
    expect(within(card()).getByText('Tap Confirm at the bottom of a day to keep one.')).toBeInTheDocument();
    expect(within(card()).queryByText(/Older records are kept/)).not.toBeInTheDocument();
    expect(within(card()).queryByRole('list')).not.toBeInTheDocument();
  });

  it('says so when every record is older than fifteen days', async () => {
    await open(fakePastriesSource({ logs: [logDoc('Sunday', [['Too old', 9]], '2026-09-01')] }));
    expect(await within(card()).findByText('No records yet.')).toBeInTheDocument();
  });

  it('follows another phone\'s record as it arrives', async () => {
    const source = seeded();
    await open(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    source.logs.set('2026-10-12_Tuesday', logDoc('Tuesday', [['New one', 2]], '2026-10-12'));
    act(() => { source.push(); });
    expect(cards()).toHaveLength(5);
    expect(dates()[3]).toBe('Mon 12 Oct');
  });

  it('is the right pane of the split: the seven days stay, and a day picked replaces it', async () => {
    const { router, user } = await open();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Friday/ }));
    expect(router.state.location.pathname).toBe('/pastries/Friday');
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
  });
});

describe('Records: the live listener', () => {
  // The listener reads up to 120 documents: it lives only while Records is on screen (P14).
  function watched(source: FakePastriesSource) {
    const stopped = vi.fn();
    const original = vi.mocked(source.watchLogs).getMockImplementation();
    vi.mocked(source.watchLogs).mockImplementation((onChange, onError) => {
      const stop = original?.(onChange, onError);
      return () => { stopped(); stop?.(); };
    });
    return stopped;
  }

  it('is not started by the day screen', async () => {
    const source = seeded();
    renderPastries('/pastries/Thursday', { source });
    await screen.findByRole('tabpanel', undefined, LOAD);
    expect(source.watchLogs).not.toHaveBeenCalled();
  });

  it('starts when Records opens and stops when it goes away', async () => {
    const source = seeded();
    const stopped = watched(source);
    const { user } = renderPastries('/pastries/Thursday', { source });
    await screen.findByRole('tabpanel', undefined, LOAD);

    await user.click(screen.getByRole('link', { name: 'Records' }));
    await screen.findByRole('heading', { level: 2, name: 'Records' });
    expect(source.watchLogs).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: /^Monday/ }));
    await screen.findByRole('tabpanel');
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh listener every time Records is opened', async () => {
    const source = seeded();
    const stopped = watched(source);
    const { user } = renderPastries('/pastries/records', { source });
    await screen.findByRole('heading', { level: 2, name: 'Records' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('tabpanel');
    await user.click(screen.getByRole('link', { name: 'Records' }));
    await screen.findByRole('heading', { level: 2, name: 'Records' });
    expect(source.watchLogs).toHaveBeenCalledTimes(2);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('says so when the stream dies', async () => {
    const source = seeded();
    await open(source);
    act(() => { source.breakStreams(); });
    expect(await within(region()).findByText('Live sync interrupted — these records may be out of date.')).toBeInTheDocument();
  });
});

describe('Records: removing one', () => {
  const BIN = 'Remove the record for Thursday, Wed 14 Oct';

  it('names every bin by the day and the date it removes', async () => {
    await open();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(screen.getByRole('button', { name: BIN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the record for Friday, Wed 14 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the record for Wednesday, Tue 13 Oct' })).toBeInTheDocument();
  });

  it('asks first, in a danger question, and Cancel keeps the record', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(await screen.findByRole('button', { name: BIN }));
    const ask = await dialog('Remove this record?');
    expect(ask).toHaveAccessibleDescription('Remove the record for Thursday, Wed 14 Oct? This cannot be undone.');
    expect(within(ask).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(source.deleteLog).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(4);
  });

  it('removes it on Remove, says so, and the card goes', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(await screen.findByRole('button', { name: BIN }));
    await user.click(within(await dialog('Remove this record?')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => { expect(source.deleteLog).toHaveBeenCalledWith('2026-10-14_Thursday'); });
    expect(await within(region()).findByText('Record removed.')).toBeInTheDocument();
    await waitFor(() => { expect(cards()).toHaveLength(3); });
    expect(screen.queryByRole('button', { name: BIN })).not.toBeInTheDocument();
  });

  it('puts the focus on the title when the card it was on is gone', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: BIN }));
    await user.click(within(await dialog('Remove this record?')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Records' })).toHaveFocus(); });
  });

  it('says it could not, and keeps the record, when the server refuses', async () => {
    const source = seeded();
    source.refuse.deleteLog = true;
    const { user } = await open(source);
    await user.click(await screen.findByRole('button', { name: BIN }));
    await user.click(within(await dialog('Remove this record?')).getByRole('button', { name: 'Remove' }));

    expect(await within(region()).findByText('Couldn’t remove that record — check your connection.')).toBeInTheDocument();
    expect(within(region()).queryByText('Record removed.')).not.toBeInTheDocument();
    expect(cards()).toHaveLength(4);
  });
});

describe('Records: Back', () => {
  it('returns to the same day when it was opened from it', async () => {
    const { router, user } = renderPastries('/pastries/Tuesday', { source: seeded() });
    await screen.findByRole('tabpanel', undefined, LOAD);
    await user.click(screen.getByRole('link', { name: 'Records' }));
    await screen.findByRole('heading', { level: 2, name: 'Records' });
    // No day is chosen on Records, but the list of days is still one stop of the keyboard.
    expect(screen.queryByRole('tab', { selected: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').filter(node => node.tabIndex === 0)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Tuesday'); });
    expect(router.state.historyAction).toBe('POP');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tuesday' })).toBeInTheDocument();
  });

  it('goes to the start of Pastries, replacing itself, when it was opened by its address', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('puts the focus on its title when opened from the day, and on the pencil when Back returns', async () => {
    const { user } = renderPastries('/pastries/Tuesday', { source: seeded() });
    await screen.findByRole('tabpanel', undefined, LOAD);
    await user.click(screen.getByRole('link', { name: 'Records' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Records' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit Tuesday' })).toHaveFocus(); });
  });
});

describe('Records: in Italian', () => {
  it('says the title, the subtitle, the dates, the badge and the rest in Italian', async () => {
    await open(seeded(), 'it');
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(within(card()).getByText('Ultimi 15 giorni')).toBeInTheDocument();
    expect(dates()).toEqual(['mer 14 ott', 'mer 14 ott', 'mar 13 ott', 'mar 29 set']);
    expect(within(cards()[0] as HTMLElement).getByText('Giovedì')).toBeInTheDocument();
    expect(within(cards()[2] as HTMLElement).getByText('Non è stato messo niente a lievitare.')).toBeInTheDocument();
    expect(within(card()).getByText('I record più vecchi restano — questa schermata mostra gli ultimi 15 giorni.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Indietro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Togli la registrazione di Giovedì, mer 14 ott' })).toBeInTheDocument();
  });

  it('says the empty state in Italian', async () => {
    await open(fakePastriesSource(), 'it');
    expect(await within(card()).findByText('Ancora nessun registro.')).toBeInTheDocument();
    expect(within(card()).getByText('Tocca Conferma in fondo a una giornata per conservarla.')).toBeInTheDocument();
  });

  it('asks and answers in Italian', async () => {
    const source = seeded();
    const { user } = await open(source, 'it');
    await user.click(await screen.findByRole('button', { name: 'Togli la registrazione di Giovedì, mer 14 ott' }));
    const ask = await dialog('Vuoi togliere questo registro?');
    expect(ask).toHaveAccessibleDescription('Togliere la registrazione di Giovedì, mer 14 ott? Non si può annullare.');
    await user.click(within(ask).getByRole('button', { name: 'Rimuovi' }));
    expect(await within(region()).findByText('Registro tolto.')).toBeInTheDocument();
  });
});
