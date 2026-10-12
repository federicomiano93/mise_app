import { Check } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useClientsEditor } from './clientsEditorContext';

// Save, the bar's one primary action on both screens of the Clients editor. It waits for a change, and a save in
// flight shows it is pending.
export function ClientsSaveButton() {
  const { t } = useT();
  const { dirty, saving, save } = useClientsEditor();
  return (
    <Button variant="primary" isDisabled={!dirty} isPending={saving} onPress={() => { void save(); }}>
      <Check aria-hidden="true" />
      {t('ui.save')}
    </Button>
  );
}
