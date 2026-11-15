import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { LIST_STATUS } from '@mise/shared/list-status';
import { renderWithSession } from '../testing/renderWithSession';
import { NoAnswerYet } from './NoAnswerYet';

// What the box says for each status, apart from the screens around it.
describe('NoAnswerYet', () => {
  it('waiting says «Loading…» in a busy live region', () => {
    renderWithSession(<NoAnswerYet status={LIST_STATUS.waiting} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('unreachable says it has not arrived, and is no longer busy', () => {
    renderWithSession(<NoAnswerYet status={LIST_STATUS.unreachable} />);
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('This list has not arrived yet')).toBeInTheDocument();
  });

  it('⚠️ failed renders the empty region: «Loading…» never stands under an error line', () => {
    renderWithSession(<NoAnswerYet status={LIST_STATUS.failed} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('quiet keeps the words for the eye but is no live region', () => {
    renderWithSession(<NoAnswerYet status={LIST_STATUS.waiting} quiet />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
