import { useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { createMemoryRouter, useNavigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { DataProvider } from '../data/DataContext';
import type { DataServices } from '../data/DataContext';
import { StatusMessageProvider } from '../ui/StatusMessage';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { renderWithSession } from '../testing/renderWithSession';
import { CreateIngredientOverlay, CreateIngredientProvider } from './CreateIngredientOverlay';

// The ingredient card drawn HOSTED, in a dialog above another screen (T15). The host here is a bare harness; what the Recipe
// catalogue does around it is in RecipesSection.createIngredient.spec.tsx.

type Done = { id: string; name: string } | null;
type Handles = {
  backRef: MutableRefObject<(() => void) | null>;
  go: () => void;
  dirty: boolean;
  done: Done[];
};

function setup(session = {}) {
  const source = fakeSuppliersSource();
  const handles: Handles = { backRef: { current: null }, go: () => undefined, dirty: false, done: [] };

  function Host() {
    const navigate = useNavigate();
    const backRef = useRef<(() => void) | null>(null);
    const [dirty, setDirty] = useState(false);
    handles.backRef = backRef;
    handles.go = () => { void navigate('/elsewhere'); };
    handles.dirty = dirty;
    return (
      <CreateIngredientOverlay
        name="Rye flour"
        open
        ingredients={[]}
        suppliers={[]}
        backRef={backRef}
        onDirty={setDirty}
        onDone={made => { handles.done.push(made); }}
      />
    );
  }

  const router = createMemoryRouter([
    { path: '/', element: <Host /> },
    { path: '/elsewhere', element: <p>Elsewhere</p> },
  ], { initialEntries: ['/'] });
  const services = { suppliers: () => source } as unknown as DataServices;
  const view = renderWithSession(
    <DataProvider services={services}>
      <StatusMessageProvider>
        <CreateIngredientProvider>
          <RouterProvider router={router} />
        </CreateIngredientProvider>
      </StatusMessageProvider>
    </DataProvider>,
    { session },
  );
  return { ...view, source, handles, router };
}

const card = async () => within(await screen.findByRole('region', { name: 'New ingredient' }));

describe('the hosted ingredient card', () => {
  it('opens with the typed name filled in, no kind choice and no pack photo', async () => {
    setup();
    const region = await card();
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('Rye flour');
    expect(screen.getByRole('dialog', { name: 'New ingredient' })).toBeInTheDocument();
    expect(region.queryByText(/packaging/i)).not.toBeInTheDocument();
  });

  it('⚠️ an untouched card with a preset name is not dirty, and Back closes it without a question', async () => {
    const { handles, user } = setup();
    const region = await card();
    expect(handles.dirty).toBe(false);
    await user.click(region.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(handles.done).toEqual([null]);
  });

  it('typing makes it dirty, and Back asks: Cancel keeps the typing, Discard closes with nothing', async () => {
    const { handles, user, source } = setup();
    const region = await card();
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 's');
    expect(handles.dirty).toBe(true);
    await user.click(region.getByRole('button', { name: 'Back' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(handles.done).toEqual([]);
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('Rye flours');
    await user.click(region.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    expect(handles.done).toEqual([null]);
    expect(source.writes).toEqual([]);
  });

  it('⚠️ registers no router blocker: a navigation with typing in the card goes through unasked', async () => {
    const { handles, user, router } = setup();
    const region = await card();
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 's');
    act(() => { handles.go(); });
    await screen.findByText('Elsewhere');
    expect(router.state.location.pathname).toBe('/elsewhere');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('exposes its own Back to the host, which asks when something was typed', async () => {
    const { handles, user } = setup();
    const region = await card();
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 's');
    act(() => { handles.backRef.current?.(); });
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(handles.done).toEqual([]);
  });

  it('saves one ingredient write with the name, and hands back its id and the name to show', async () => {
    const { handles, user, source } = setup();
    const region = await card();
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));
    const writes = source.writes.filter(write => write.op === 'ingredient-save');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ data: { name: 'Rye flour' }, price: null });
    expect(handles.done).toEqual([{ id: writes[0]!.id, name: 'Rye flour' }]);
    expect(await screen.findByText('Ingredient saved.')).toBeInTheDocument();
  });
});
