import { Check } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useWhatsappEditor } from './whatsappEditorContext';

// Save, the bar's one primary action on the screens of a WhatsApp item that save (the list, a client's lines, the direct
// client). It waits for a change, and a save in flight shows it is pending.
export function WhatsappSaveButton() {
  const { t } = useT();
  const { dirty, saving, save } = useWhatsappEditor();
  return (
    <Button variant="primary" isDisabled={!dirty} isPending={saving} onPress={() => { void save(); }}>
      <Check aria-hidden="true" />
      {t('ui.save')}
    </Button>
  );
}
