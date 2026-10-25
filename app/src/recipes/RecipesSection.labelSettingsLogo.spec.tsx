import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';
import { prepareLogo } from './logoUpload';

// The label Settings for the «with logo» model (step 3e): the model choice, the header, the logo and the rotate switch,
// and the standard cards coming back when the choice goes back. jsdom has no canvas, so the picture's preparation is
// replaced; what is under test is what the screen does with its answer.

vi.mock('./logoUpload', async importOriginal => {
  const actual = await importOriginal<typeof import('./logoUpload')>();
  return { ...actual, prepareLogo: vi.fn() };
});

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(prepareLogo).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const GB = { country: 'GB' };
const LOGO = { png: 'data:image/png;base64,AAAA', width: 1320, height: 300 };
const NEW_LOGO = { png: 'data:image/png;base64,BBBB', width: 1320, height: 200 };

type Options = {
  labelConfig?: Record<string, unknown> | null;
  logo?: Record<string, unknown> | null;
  source?: ReturnType<typeof fakeRecipesSource>;
  lang?: 'en' | 'it';
};

async function openSettings({ labelConfig = { template: 'logo' }, logo = null, source, lang = 'en' }: Options = {}) {
  const src = source ?? fakeRecipesSource({ recipes: [recipe('r1')], labelConfig, logo });
  const view = renderRecipes('/recipes/settings', { source: src, lang, session: { location: GB, language: lang } });
  await screen.findByRole('region', { name: lang === 'it' ? 'Impostazioni' : 'Settings' }, LOAD);
  return { ...view, source: src };
}

const settings = () => within(screen.getByRole('region', { name: 'Settings' }));
const group = (name: string) => settings().getByRole('radiogroup', { name });
const choice = (groupName: string, text: string) => within(group(groupName)).getByRole('radio', { name: text });
const logoCard = () => within(settings().getByRole('region', { name: 'Logo' }));
const fileBox = () => screen.getByTestId('logo-file') as HTMLInputElement;
const pickFile = (name = 'logo.png') => {
  fireEvent.change(fileBox(), { target: { files: [new File(['x'], name, { type: 'image/png' })] } });
};
const PAPER = 'Label printing';

describe('the model choice', () => {
  it('offers Standard and With logo, with Standard chosen by default, and the standard cards in place', async () => {
    await openSettings({ labelConfig: null });
    expect(within(group('Label model')).getAllByRole('radio').map(radio => radio.textContent))
      .toEqual(['Standard', 'With logo (Zebra 80 × 60)']);
    expect(choice('Label model', 'Standard')).toBeChecked();
    expect(settings().getByRole('heading', { level: 3, name: PAPER })).toBeInTheDocument();
    expect(settings().getByRole('heading', { level: 3, name: 'What else goes on the label' })).toBeInTheDocument();
    expect(settings().queryByRole('region', { name: 'Logo' })).not.toBeInTheDocument();
    expect(settings().queryByRole('switch', { name: 'Print turned round' })).not.toBeInTheDocument();
    expect(settings().getByText(/prints the shop’s own label, made as an image/)).toBeInTheDocument();
  });

  it('saves the model on the tap and only when it changes', async () => {
    const { source, user } = await openSettings({ labelConfig: null });
    await user.click(choice('Label model', 'Standard'));
    expect(source.labelSaves).toEqual([]);
    await user.click(choice('Label model', 'With logo (Zebra 80 × 60)'));
    expect(source.labelSaves).toEqual([{ template: 'logo' }]);
    expect(choice('Label model', 'With logo (Zebra 80 × 60)')).toBeChecked();
  });

  it('⚠️ with the logo model hides the paper and «what else» cards, and shows the header, the logo and the rotate switch', async () => {
    await openSettings();
    expect(choice('Label model', 'With logo (Zebra 80 × 60)')).toBeChecked();
    expect(settings().queryByRole('heading', { level: 3, name: PAPER })).not.toBeInTheDocument();
    expect(settings().queryByRole('heading', { level: 3, name: 'What else goes on the label' })).not.toBeInTheDocument();
    expect(settings().queryByRole('radiogroup', { name: 'Label size' })).not.toBeInTheDocument();
    expect(settings().queryByRole('radiogroup', { name: 'Printer' })).not.toBeInTheDocument();
    expect(settings().queryByRole('switch', { name: 'Leave room for a date' })).not.toBeInTheDocument();
    expect(settings().getByRole('heading', { level: 3, name: 'Header' })).toBeInTheDocument();
    expect(settings().getByRole('textbox', { name: 'Business name' })).toBeInTheDocument();
    expect(settings().getByRole('textbox', { name: 'Address' })).toBeInTheDocument();
    expect(settings().getByRole('heading', { level: 3, name: 'Logo' })).toBeInTheDocument();
    expect(settings().getByRole('switch', { name: 'Print turned round' })).toBeChecked();
    // The photograph reader's card stays first.
    expect(settings().getAllByRole('heading', { level: 3 })[0]).not.toHaveTextContent('Label model');
  });

  it('the header boxes are always there in logo mode and save like the standard ones', async () => {
    const { source, user } = await openSettings();
    await user.type(settings().getByRole('textbox', { name: 'Business name' }), 'Bakery Ltd{Enter}');
    expect(source.labelSaves).toEqual([{ businessName: 'Bakery Ltd' }]);
  });

  it('⚠️ going back to Standard brings the old cards back', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label model', 'Standard'));
    expect(source.labelSaves).toEqual([{ template: 'standard' }]);
    expect(await settings().findByRole('heading', { level: 3, name: PAPER })).toBeInTheDocument();
    expect(settings().getByRole('heading', { level: 3, name: 'What else goes on the label' })).toBeInTheDocument();
    expect(settings().queryByRole('region', { name: 'Logo' })).not.toBeInTheDocument();
  });

  it('the rotate switch saves false when turned off, and shows a stored false as off', async () => {
    const { source, user } = await openSettings();
    await user.click(settings().getByRole('switch', { name: 'Print turned round' }));
    expect(source.labelSaves).toEqual([{ rotate180: false }]);
    expect(settings().getByRole('switch', { name: 'Print turned round' })).not.toBeChecked();
    await user.click(settings().getByRole('switch', { name: 'Print turned round' }));
    expect(source.labelSaves).toEqual([{ rotate180: false }, { rotate180: true }]);
  });

  it('says its words in Italian', async () => {
    await openSettings({ lang: 'it' });
    const region = within(screen.getByRole('region', { name: 'Impostazioni' }));
    expect(region.getByRole('radiogroup', { name: 'Modello di etichetta' })).toBeInTheDocument();
    expect(region.getByRole('switch', { name: 'Stampa capovolta' })).toBeInTheDocument();
    expect(region.getByRole('heading', { level: 3, name: 'Intestazione' })).toBeInTheDocument();
  });
});

describe('the logo', () => {
  it('with no logo says so and offers «Choose logo» only', async () => {
    await openSettings({ logo: null });
    expect(await logoCard().findByText(/No logo yet/)).toBeInTheDocument();
    expect(logoCard().getByRole('button', { name: 'Choose logo' })).toBeInTheDocument();
    expect(logoCard().queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
    expect(logoCard().queryByRole('img')).not.toBeInTheDocument();
    expect(fileBox()).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
  });

  it('with a stored logo shows the picture, «Change logo» and the low-key remove button', async () => {
    await openSettings({ logo: LOGO });
    const picture = await logoCard().findByRole('img', { name: 'The logo as it will be printed' });
    expect(picture).toHaveAttribute('src', LOGO.png);
    expect(logoCard().getByRole('button', { name: 'Change logo' })).toBeInTheDocument();
    expect(logoCard().getByRole('button', { name: 'Remove logo' })).toBeInTheDocument();
  });

  it('says so when the logo could not be read', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1')], labelConfig: { template: 'logo' }, logo: LOGO });
    source.refuseLogo = true;
    await openSettings({ source });
    expect(await logoCard().findByText(/Could not load the logo/)).toBeInTheDocument();
  });

  it('⚠️ a picked file is prepared, saved, said saved, and its picture is shown; the box is emptied for the next pick', async () => {
    vi.mocked(prepareLogo).mockResolvedValue(NEW_LOGO);
    const { source } = await openSettings({ logo: LOGO });
    await logoCard().findByRole('img');
    pickFile();
    await waitFor(() => { expect(source.logoWrites).toEqual([NEW_LOGO]); });
    expect(prepareLogo).toHaveBeenCalledTimes(1);
    expect(await logoCard().findByText('Logo saved.')).toBeInTheDocument();
    await waitFor(() => { expect(logoCard().getByRole('img')).toHaveAttribute('src', NEW_LOGO.png); });
    expect(fileBox().value).toBe('');
    expect(isBusy()).toBe(false);
  });

  it('holds the app busy and the card aria-busy while the logo is being written', async () => {
    vi.mocked(prepareLogo).mockResolvedValue(NEW_LOGO);
    const { source } = await openSettings();
    const release = source.holdLogoWrites();
    await logoCard().findByRole('button', { name: 'Choose logo' });
    pickFile();
    await waitFor(() => { expect(isBusy()).toBe(true); });
    expect(settings().getByRole('region', { name: 'Logo' })).toHaveAttribute('aria-busy', 'true');
    expect(logoCard().getByRole('button', { name: 'Choose logo' })).toBeDisabled();
    release();
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(settings().getByRole('region', { name: 'Logo' })).not.toHaveAttribute('aria-busy');
  });

  it('takes one pick at a time', async () => {
    vi.mocked(prepareLogo).mockResolvedValue(NEW_LOGO);
    const { source } = await openSettings();
    const release = source.holdLogoWrites();
    await logoCard().findByRole('button', { name: 'Choose logo' });
    pickFile('a.png');
    pickFile('b.png');
    release();
    await waitFor(() => { expect(source.logoWrites).toHaveLength(1); });
    expect(prepareLogo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blank', /empty or all white/],
    ['too-tall', /too tall for the label/],
    ['undecodable', /could not be opened as a picture/],
    ['too-big', /too big to be saved/],
  ] as const)('says what is wrong with an image refused as «%s», and writes nothing', async (code, sentence) => {
    const { LogoError } = await import('./logoUpload');
    vi.mocked(prepareLogo).mockRejectedValue(new LogoError(code));
    const { source } = await openSettings();
    await logoCard().findByRole('button', { name: 'Choose logo' });
    pickFile();
    const live = logoCard().getAllByRole('status')[0] as HTMLElement;
    await waitFor(() => { expect(live).toHaveTextContent(sentence); });
    expect(source.logoWrites).toEqual([]);
    expect(isBusy()).toBe(false);
  });

  it('⚠️ a refused write is said, and the next pick can try again', async () => {
    vi.mocked(prepareLogo).mockResolvedValue(NEW_LOGO);
    const { source } = await openSettings();
    source.refuseLogoWrites = true;
    await logoCard().findByRole('button', { name: 'Choose logo' });
    pickFile();
    expect(await logoCard().findByText(/Could not save the logo/)).toBeInTheDocument();
    expect(source.logoWrites).toEqual([]);
    source.refuseLogoWrites = false;
    pickFile();
    await waitFor(() => { expect(source.logoWrites).toEqual([NEW_LOGO]); });
    expect(await logoCard().findByText('Logo saved.')).toBeInTheDocument();
  });

  it('⚠️ Remove asks first: Cancel keeps the logo, the confirm takes it away', async () => {
    const { source, user } = await openSettings({ logo: LOGO });
    await logoCard().findByRole('img');
    await user.click(logoCard().getByRole('button', { name: 'Remove logo' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Remove the logo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.logoWrites).toEqual([]);
    expect(logoCard().getByRole('img')).toBeInTheDocument();

    await user.click(logoCard().getByRole('button', { name: 'Remove logo' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Remove the logo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove logo' }));
    await waitFor(() => { expect(source.logoWrites).toEqual([{ removed: true }]); });
    expect(await logoCard().findByText(/No logo yet/)).toBeInTheDocument();
    expect(logoCard().queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so when the logo could not be removed, and keeps it', async () => {
    const { source, user } = await openSettings({ logo: LOGO });
    await logoCard().findByRole('img');
    source.refuseLogoWrites = true;
    await user.click(logoCard().getByRole('button', { name: 'Remove logo' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove the logo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove logo' }));
    expect(await logoCard().findByText(/Could not remove the logo/)).toBeInTheDocument();
    expect(logoCard().getByRole('img')).toBeInTheDocument();
  });
});
