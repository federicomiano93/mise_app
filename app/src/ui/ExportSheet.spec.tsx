import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { libraryError } from '@mise/shared/recipe-export';
import type { ExportModel } from '@mise/shared/recipe-export';
import { I18nProvider } from '../i18n/I18nProvider';
import { it as italian } from '../i18n/it';
import { useExportSheet } from './ExportSheet';

// The export dialog: the choice, «Preparing the file…», «File ready» with a real Download link (and Share for the
// PDF only), the errors, and the focus handed back. The two builders are replaced: the files themselves are
// pinned in recipeExport.spec.ts.

const builders = vi.hoisted(() => ({ buildPdfBlob: vi.fn(), buildXlsxBlob: vi.fn() }));
vi.mock('./recipeExport', () => builders);

const MODEL: ExportModel = {
  name: 'Torta di prova',
  trays: 0,
  totalG: 1500,
  rows: [{ name: 'Farina di prova', grams: 1000.4 }, { name: 'Acqua di prova', grams: 499.6 }],
};

function Opener({ model = MODEL }: { model?: ExportModel }) {
  const [open, sheet] = useExportSheet();
  return (
    <>
      <button type="button" onClick={() => { open({ model, totalLabel: 'Total' }); }}>Export</button>
      {sheet}
    </>
  );
}

const pdf = () => new Blob(['%PDF'], { type: 'application/pdf' });
const xlsx = () => new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

let created: Blob[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  builders.buildPdfBlob.mockReset().mockImplementation(() => Promise.resolve(pdf()));
  builders.buildXlsxBlob.mockReset().mockImplementation(() => Promise.resolve(xlsx()));
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => { created.push(blob); return `blob:test/${String(created.length)}`; },
    revokeObjectURL: (url: string) => { revoked.push(url); },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

function draw(model?: ExportModel) {
  const user = userEvent.setup();
  render(<Opener model={model} />);
  return { user, opener: screen.getByRole('button', { name: 'Export' }) };
}

const sheet = () => screen.findByRole('dialog', { name: 'Export as' });

async function choose(user: ReturnType<typeof userEvent.setup>, kind: 'PDF' | 'Excel') {
  await user.click(screen.getByRole('button', { name: 'Export' }));
  await user.click(within(await sheet()).getByRole('button', { name: new RegExp(`^${kind}`) }));
}

const ready = () => screen.findByRole('dialog', { name: 'File ready' });

function allowShare(files: boolean) {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => files), configurable: true });
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

describe('the choice', () => {
  it('offers PDF, Excel and Cancel, each kind with its note', async () => {
    const { user } = draw();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const box = within(await sheet());
    expect(box.getAllByRole('button').map(b => b.textContent)).toEqual([
      'PDFTo print or share', 'ExcelSaved to this device', 'Cancel',
    ]);
    expect(builders.buildPdfBlob).not.toHaveBeenCalled();
  });

  it('puts the focus on the first kind, and closes on Cancel and Escape giving the focus back', async () => {
    const { user, opener } = draw();
    await user.click(opener);
    const box = within(await sheet());
    await waitFor(() => { expect(box.getByRole('button', { name: /^PDF/ })).toHaveFocus(); });
    await user.click(box.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    await user.click(opener);
    await sheet();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(opener).toHaveFocus(); });
  });
});

describe('a PDF', () => {
  it('is built from the model the screen handed over, then offered as a real Download link', async () => {
    allowShare(false);
    const { user } = draw();
    await choose(user, 'PDF');
    const box = within(await ready());
    expect(builders.buildPdfBlob).toHaveBeenCalledWith(MODEL);
    expect(builders.buildXlsxBlob).not.toHaveBeenCalled();
    const link = box.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', 'blob:test/1');
    // «Torta di prova», 1500 g, no trays.
    expect(link).toHaveAttribute('download', 'Torta_di_prova_1500g.pdf');
    expect(box.getByText('Torta_di_prova_1500g.pdf')).toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(created).toHaveLength(1);
  });

  it('offers Share when the browser says it can share this file, and shares it', async () => {
    const share = allowShare(true);
    const { user } = draw();
    await choose(user, 'PDF');
    const box = within(await ready());
    expect(box.getAllByRole('button').map(b => b.textContent)).toEqual(['Share', 'Close']);
    await user.click(box.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; title: string }])[0];
    expect(arg.title).toBe('Torta_di_prova_1500g.pdf');
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]?.name).toBe('Torta_di_prova_1500g.pdf');
    expect(arg.files[0]?.type).toBe('application/pdf');
  });

  it('shows no Share when the browser says it cannot share this file', async () => {
    allowShare(false);
    const { user } = draw();
    await choose(user, 'PDF');
    expect(within(await ready()).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('shows no Share without Web Share', async () => {
    const { user } = draw();
    await choose(user, 'PDF');
    expect(within(await ready()).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('says nothing when the person closes the phone’s share sheet without choosing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const share = allowShare(true);
    share.mockImplementation(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    const { user } = draw();
    await choose(user, 'PDF');
    await user.click(within(await ready()).getByRole('button', { name: 'Share' }));
    expect(warn).not.toHaveBeenCalled();
    share.mockImplementation(() => Promise.reject(new Error('refused')));
    await user.click(within(await ready()).getByRole('button', { name: 'Share' }));
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('export share failed'); });
  });
});

describe('an Excel file', () => {
  it('is built with the total word, offered as a Download link, and NEVER with Share', async () => {
    const share = allowShare(true);
    const { user } = draw();
    await choose(user, 'Excel');
    const box = within(await ready());
    expect(builders.buildXlsxBlob).toHaveBeenCalledWith(MODEL, 'Total', 'Recipe');
    expect(box.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'Torta_di_prova_1500g.xlsx');
    expect(box.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it('names a recipe with trays «x N», and one with no name by the word for «recipe»', async () => {
    const { user } = draw({ ...MODEL, name: '', trays: 3 });
    await choose(user, 'Excel');
    expect(within(await ready()).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'recipe_x3.xlsx');
  });
});

describe('while the file is made, and after', () => {
  it('shows «Preparing the file…» in a status that exists before its words, with Cancel under the focus', async () => {
    let finish: (blob: Blob) => void = () => undefined;
    builders.buildPdfBlob.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const { user } = draw();
    await choose(user, 'PDF');
    const box = within(await sheet());
    expect(await box.findByRole('status')).toHaveTextContent('Preparing the file…');
    await waitFor(() => { expect(box.getByRole('button', { name: 'Cancel' })).toHaveFocus(); });
    finish(pdf());
    await ready();
  });

  it('forgets a file that finishes after Cancel: nothing opens, no address is made', async () => {
    let finish: (blob: Blob) => void = () => undefined;
    builders.buildPdfBlob.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const { user, opener } = draw();
    await choose(user, 'PDF');
    await user.click(within(await sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    finish(pdf());
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(created).toHaveLength(0);
    await waitFor(() => { expect(opener).toHaveFocus(); });
  });

  it('closes from «File ready», gives the focus back, and frees the file’s address a while later', async () => {
    allowShare(false);
    const { user, opener } = draw();
    await choose(user, 'PDF');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(within(await ready()).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(30000);
    expect(revoked).toEqual(['blob:test/1']);
  });
});

describe('when the file cannot be made', () => {
  it('offline, a library that would not load asks for a connection — and reports a fixed word only', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    builders.buildPdfBlob.mockImplementation(() => Promise.reject(libraryError(new Error('Torta di prova secret'))));
    const { user } = draw();
    await choose(user, 'PDF');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Export needs a connection the first time. Connect and try again.');
    expect(report).toHaveBeenCalledWith('Recipe export failed:', 'pdf', 'library');
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/Torta|secret/);
  });

  it('online, the same failure is «could not be made» — a connection would not help', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    builders.buildXlsxBlob.mockImplementation(() => Promise.reject(libraryError(new Error('x'))));
    const { user } = draw();
    await choose(user, 'Excel');
    expect(await screen.findByRole('alert')).toHaveTextContent('The file could not be made. Try again.');
  });

  it('a bug in the build is «could not be made» even offline, reported as «build»', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    builders.buildXlsxBlob.mockImplementation(() => Promise.reject(new Error('Torta di prova secret')));
    const { user, opener } = draw();
    await choose(user, 'Excel');
    expect(await screen.findByRole('alert')).toHaveTextContent('The file could not be made. Try again.');
    expect(report).toHaveBeenCalledWith('Recipe export failed:', 'xlsx', 'build');
    await waitFor(() => { expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })).toHaveFocus(); });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(opener).toHaveFocus(); });
  });
});

describe('in Italian', () => {
  it('speaks Italian and names the file with the Italian word for a nameless recipe', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLanguage="it" initialMessages={italian}>
        <Opener model={{ ...MODEL, name: '', totalG: 0 }} />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const box = await screen.findByRole('dialog', { name: 'Esporta come' });
    expect(within(box).getByRole('button', { name: /^Excel/ })).toHaveTextContent('Si salva sul dispositivo');
    await user.click(within(box).getByRole('button', { name: /^PDF/ }));
    const done = await screen.findByRole('dialog', { name: 'File pronto' });
    expect(within(done).getByRole('link', { name: 'Scarica' })).toHaveAttribute('download', 'ricetta.pdf');
    expect(within(done).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
  });
});
