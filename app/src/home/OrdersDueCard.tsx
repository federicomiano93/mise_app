import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useOrdersDue } from './useOrdersDue';
import styles from './OrdersDueCard.module.css';

// The Orders section's address of one supplier's order. Written here rather than imported: a feature never imports another's folder
// (orders/ordersPath.ts builds the same `/orders/supplier/<id>`, the id encoded as one path segment).
const supplierOrderPath = (id: string): string => `/orders/supplier/${encodeURIComponent(id)}`;

// «Ordini da fare» on the Home (item 7 of docs/mockups/orders-tablet-2026-11.md): the suppliers still to order today, one row each; a
// tap opens that supplier's order in Orders. With none left the card is not drawn at all — and it is never drawn for somebody the venue
// does not show Orders to, nor before the server has answered (useOrdersDue). Short words only: a title and the names.
export function OrdersDueCard() {
  const { t } = useT();
  const due = useOrdersDue();
  if (due.length === 0) return null;
  return (
    <section className={styles.card} aria-labelledby="home-orders-due-title">
      <h2 id="home-orders-due-title" className={styles.title}>{t('home.ordersDue.title')}</h2>
      <ul className={styles.rows}>
        {due.map(supplier => (
          <li key={supplier.id}>
            <Link to={supplierOrderPath(supplier.id)} className={styles.row}>
              <span className={styles.name}>{supplierLabel(supplier)}</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
