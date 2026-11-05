import { Mail, MessageCircle, MessageCircleMore } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SendOffer } from '@mise/shared/send-chooser';
import type { Route } from '@mise/shared/send-routes';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { StoredDoc } from './ordersSource';
import styles from './RoadChooser.module.css';

// The in-app list for a manager has no word and no icon here: it arrives with slice 3f-7, and useSendOrder filters it out.
const ROUTE_NAME: Partial<Record<Route, MessageKey>> = {
  whatsapp: 'ord.send.route.whatsapp',
  whatsappSupplier: 'ord.send.route.whatsappSupplier',
  email: 'ord.send.route.email',
};

// The two WhatsApp roads share the green-bubble idea; the one straight to the supplier carries a «more» mark so they can be
// told apart at a glance without a brand.
const ROUTE_ICON: Partial<Record<Route, ReactNode>> = {
  whatsapp: <MessageCircle aria-hidden="true" />,
  whatsappSupplier: <MessageCircleMore aria-hidden="true" />,
  email: <Mail aria-hidden="true" />,
};

type Props = {
  offers: readonly SendOffer<StoredDoc>[];
  // The road's own button was pressed. ⚠️ Called inside that press, so the sender can open its windows inside the tap.
  onPick: (offer: SendOffer<StoredDoc>) => void;
  // Escape, the backdrop or Cancel: nothing is sent.
  onCancel: () => void;
};

// «How should this order go?» — one big button per road, with what it costs said under it (the one-chat-at-a-time note, who
// has no contact saved, that email only opens the mail app). On the shared Dialog, so it has a role, closes on Escape, traps the
// focus and gives it back (finding F-4: the current app's chooser had none of those).
export function RoadChooser({ offers, onPick, onCancel }: Props) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      title={t('ord.send.howTitle')}
      dismissable
      onClose={onCancel}
      actions={<Button onPress={onCancel}>{t('common.cancel')}</Button>}
    >
      <div className={styles.roads}>
        {offers.map((offer, index) => {
          const name = ROUTE_NAME[offer.route];
          if (name === undefined) return null;
          return (
          <Button
            key={offer.route}
            variant="bare"
            className={styles.road}
            autoFocus={index === 0}
            onPress={() => { onPick(offer); }}
          >
            {ROUTE_ICON[offer.route]}
            <span className={styles.text}>
              <span className={styles.name}>{t(name)}</span>
              {offer.note !== '' ? <span className={styles.note}>{offer.note}</span> : null}
              {offer.route === 'email' ? <span className={styles.note}>{t('ord.send.emailOpensApp')}</span> : null}
            </span>
          </Button>
          );
        })}
      </div>
    </Dialog>
  );
}
