import { Check } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useRecipesEditor } from './recipesEditorContext';

// Save, the bar's one primary action on both screens of the Recipes editor. It waits for a change, and a save in
// flight shows it is pending.
export function RecipesSaveButton() {
  const { t } = useT();
  const { dirty, saving, save } = useRecipesEditor();
  return (
    <Button variant="primary" isDisabled={!dirty} isPending={saving} onPress={() => { void save(); }}>
      <Check aria-hidden="true" />
      {t('ui.save')}
    </Button>
  );
}
