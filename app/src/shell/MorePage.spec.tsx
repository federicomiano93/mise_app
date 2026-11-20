import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';
import morePageCss from './MorePage.module.css?raw';

// jsdom applies no media query, so every row is in the DOM: what these specs pin is the DATA each row carries (which screen it is for)
// and the stylesheet that turns it into «phones list everything without a tab, from 700px only what the rail spilled».
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');
const nameOf = (row: HTMLElement) => row.textContent;
const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const, location: {} };

describe('the «More» page', () => {
  it('marks every row for the phone, and the two last rail sections as the ones the rail spills', () => {
    renderApp('/more');
    expect(rows().map(nameOf)).toEqual(['Bookings', 'Suppliers', 'Labels', 'Pastries', 'Stocktake', 'Food cost', 'Cakes', 'Settings']);
    for (const row of rows()) expect(row).toHaveAttribute('data-phone');
    expect(rows().filter(row => row.hasAttribute('data-spill')).map(nameOf)).toEqual(['Food cost', 'Cakes']);
    expect(screen.getByRole('list')).toHaveAttribute('data-spill');
  });

  it('says what the page is for on a tablet, under the title', () => {
    renderApp('/more');
    expect(screen.getByText('The sections that don’t fit in this screen’s rail.')).toBeInTheDocument();
    expect(screen.queryByText('All sections are in the rail')).not.toBeInTheDocument();
  });

  it('says that every section is in the rail when nothing spills, and marks no row', () => {
    renderApp('/more', { session: EMPLOYEE });
    expect(screen.getByText('All sections are in the rail')).toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveAttribute('data-spill');
    expect(rows().map(nameOf)).toEqual(['Bookings', 'Suppliers', 'Labels', 'Pastries', 'Settings']);
    for (const row of rows()) expect(row).not.toHaveAttribute('data-spill');
  });

  it('says it in Italian too', () => {
    renderApp('/more', { lang: 'it', session: EMPLOYEE });
    expect(screen.getByText('Tutte le sezioni sono nella barra')).toBeInTheDocument();
  });

  it('switches by width with the stylesheet alone: phones drop the rows with no data-phone, tablets those with no data-spill', () => {
    const css = morePageCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/@media \(max-width: 699\.98px\) \{[^@]*\.item:not\(\[data-phone\]\),\s*\.railNote\s*\{\s*display: none;/);
    expect(css).toMatch(/@media \(min-width: 700px\) \{[^@]*\.item:not\(\[data-spill\]\)\s*\{\s*display: none;/);
    expect(css).toMatch(/\.list:not\(\[data-spill\]\)\s*\{\s*display: none;/);
  });
});
