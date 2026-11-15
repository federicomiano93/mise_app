import { useEffect } from 'react';
import { useT } from '../../i18n/useT';
import { useAlert } from '../../ui/useAlert';
import { useAwayStore } from './AwayContext';

// «Not saved», when the server refused a holiday change — said ONCE, by the shell, wherever the person is when the answer arrives.
//
// ⚠️ NOT BY THE SCREEN THAT WROTE IT: the write shows at once and its answer settles only when the server speaks (offline, whenever the
// signal comes back), by which time the Home or Settings may long be gone and nothing there could say it. A silent put-back would leave
// somebody believing they had come back while their phone stays quiet. A dialog, as the current app's js/away-screen.js says it.
export function AwayRefusalAlert() {
  const { t } = useT();
  const store = useAwayStore();
  const [alert, alertDialog] = useAlert();

  useEffect(() => store.onRefused(() => {
    void alert({ title: t('away.title'), message: t('away.saveFailed'), okLabel: t('common.ok') });
  }), [store, alert, t]);

  return <>{alertDialog}</>;
}
