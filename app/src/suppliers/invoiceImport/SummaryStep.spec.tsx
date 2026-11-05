import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RunTotals } from '@mise/shared/invoice-import-plan';
import { en } from '../../i18n/en';
import { I18nProvider } from '../../i18n/I18nProvider';
import { it as italian } from '../../i18n/it';
import { RunningStep } from './RunningStep';
import { SummaryStep } from './SummaryStep';

// The end of the import and the busy view, drawn alone: which lines appear when, and when «load the same file again» is said.
//
// PORTS (tests/invoice-import-flow.test.mjs): «“Load the same file again” only when a second load can help» (the .json half — “an
// invalid entry says to fix the workbook” — is not ported, F6), «a write that failed DOES say to load the same file again»,
// «the summary shows the changes recorded, also when there are none», «a failure while remembering … is reported in the summary».

const totals = (over: Partial<RunTotals> = {}): RunTotals => ({
  namesSaved: 0, namesLost: 0, created: 0, updated: 0, pricesAdded: 0, changesAdded: 0, changesFailed: 0, unchanged: 0, skipped: 0,
  codesFull: 0, failed: [], stopped: null, notRun: 0, retryable: 0, notFixableByRetry: 0, ...over,
});

function draw(summary: RunTotals, extra: { decisionsWritten?: number; decisionsFailed?: boolean } = {}, lang: 'en' | 'it' = 'en') {
  render(
    <I18nProvider initialLanguage={lang} initialMessages={lang === 'en' ? en : italian}>
      <SummaryStep headingRef={null} summary={summary} decisionsWritten={extra.decisionsWritten ?? 0} decisionsFailed={extra.decisionsFailed ?? false} />
    </I18nProvider>,
  );
}

const lines = () => within(screen.getByRole('list')).getAllByRole('listitem').map(item => item.textContent);

describe('the summary', () => {
  it('always counts what was created, updated, added, recorded, left unchanged and skipped — zero included', () => {
    draw(totals());
    expect(lines()).toEqual([
      '0 ingredients created', '0 existing ingredients got new prices', '0 prices added', 'Price changes recorded: 0', '0 unchanged', '0 skipped',
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'Import finished' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts the saved invoice names after the prices, and the optional lines after the rest', () => {
    draw(totals({ created: 1, updated: 2, pricesAdded: 3, namesSaved: 1, namesLost: 2, codesFull: 1, changesAdded: 4 }), { decisionsWritten: 5 });
    expect(lines()).toEqual([
      '1 ingredient created', '2 existing ingredients got new prices', '3 prices added', '1 name on the invoice saved',
      'Price changes recorded: 4', '0 unchanged', '0 skipped',
      '2 names on the invoice not saved: they changed while importing — load the file again',
      'Choices remembered: 5', '1 ingredient could not remember its new pack code (20 codes already)',
    ]);
  });

  it('a run the rules stopped says so in an alert, with how many were not tried, and says to load the file again', () => {
    draw(totals({ stopped: 'permission', notRun: 2, failed: [{ key: 'k', name: 'Sale', reason: 'Mise was not allowed', retry: true }], retryable: 1 }));
    expect(screen.getByRole('alert')).toHaveTextContent('Mise was not allowed to save this: your account may not change prices here. The import stopped. 2 ingredients were not tried.');
    expect(screen.getByText('Load the same file again to finish: what is already saved is not repeated.')).toBeInTheDocument();
    expect(screen.getByText('1 ingredient not imported')).toBeInTheDocument();
  });

  it('lists the rows that could not be imported, each with its reason', () => {
    draw(totals({ failed: [{ key: 'a', name: 'Zucchero', reason: 'Could not be saved (x).', retry: true }, { key: 'b', name: 'Olio', reason: 'It has no name.', retry: false }], retryable: 1, notFixableByRetry: 1 }));
    const failures = screen.getAllByRole('list')[1] as HTMLElement;
    expect(within(failures).getAllByRole('listitem').map(item => item.textContent)).toEqual(['ZuccheroCould not be saved (x).', 'OlioIt has no name.']);
  });

  it('⚠️ «load the same file again» only when a second load can help: an invalid entry stays invalid however often it is loaded', () => {
    draw(totals({ failed: [{ key: 'b', name: 'Olio', reason: 'It has no name.', retry: false }], notFixableByRetry: 1 }));
    expect(screen.queryByText(/Load the same file again/)).not.toBeInTheDocument();
  });

  it('says in red when the price changes or the remembered choices could not be recorded', () => {
    draw(totals({ changesFailed: 2 }), { decisionsFailed: true });
    const alerts = screen.getAllByRole('alert').map(alert => alert.textContent);
    expect(alerts).toEqual([
      'Price changes could not be recorded for 2 ingredients: load the same file again to complete them.',
      'Your choices could not be remembered. The import itself is not affected.',
    ]);
  });

  it('speaks Italian', () => {
    draw(totals({ created: 2, pricesAdded: 2 }), {}, 'it');
    expect(screen.getByRole('heading', { level: 3, name: 'Importazione conclusa' })).toBeInTheDocument();
    expect(lines().slice(0, 3)).toEqual(['2 ingredienti creati', '0 ingredienti già presenti hanno nuovi prezzi', '2 prezzi aggiunti']);
  });
});

describe('the busy view', () => {
  it('has a heading and a bar named for what it does; no bar when there is nothing to count', () => {
    const { rerender } = render(
      <I18nProvider initialLanguage="en" initialMessages={en}><RunningStep headingRef={null} done={1} total={4} /></I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Importing…' })).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Importing…' });
    expect(bar).toHaveAttribute('max', '4');
    expect(bar).toHaveAttribute('value', '1');
    rerender(<I18nProvider initialLanguage="en" initialMessages={en}><RunningStep headingRef={null} done={0} total={0} /></I18nProvider>);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
