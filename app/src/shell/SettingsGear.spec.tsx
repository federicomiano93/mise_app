import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithSession } from '../testing/renderWithSession';
import { SettingsGear } from './SettingsGear';
import iconCss from './BandIcon.module.css?raw';

describe('SettingsGear', () => {
  it('is a button named «Settings» holding the gear alone, hidden from assistive technology', () => {
    renderWithSession(<SettingsGear onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says «Impostazioni» in Italian', () => {
    renderWithSession(<SettingsGear onPress={() => undefined} />, { lang: 'it' });
    expect(screen.getByRole('button', { name: 'Impostazioni' })).toBeInTheDocument();
  });

  it('takes the section\'s own name when it has one', () => {
    renderWithSession(<SettingsGear onPress={() => undefined} label="Orders settings" />);
    expect(screen.getByRole('button', { name: 'Orders settings' })).toBeInTheDocument();
  });

  it('presses on a click and on the keyboard', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    renderWithSession(<SettingsGear onPress={onPress} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('hands its button to a ref, for the focus Back gives back', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithSession(<SettingsGear onPress={() => undefined} ref={ref} />);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Settings' }));
  });

  it('says it is the current one while the settings are open beside the list', () => {
    renderWithSession(<SettingsGear onPress={() => undefined} aria-current="true" />);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'true');
  });

  it('is a 48px square that never shrinks (the shared band icon)', () => {
    const css = iconCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.icon\s*\{[^}]*flex:\s*none;[^}]*width:\s*var\(--hit\);\s*height:\s*var\(--hit\)/);
  });
});
