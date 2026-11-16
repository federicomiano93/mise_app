import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import type { StoredDoc } from './ordersDueSource';
import styles from './OrdersDueCard.module.css';

// The Orders section's address of one supplier's order. Written here rather than imported: a feature never imports another's folder
// (orders/ordersPath.ts builds the same `/orders/supplier/<id>`, the id encoded as one path segment).
const supplierOrderPath = (id: string): string => `/orders/supplier/${encodeURIComponent(id)}`;

// «Ordini da fare» on the Home (item 7 of docs/mockups/orders-tablet-2026-11.md): the suppliers still to order today, one row each; a
// tap opens that supplier's order in Orders. With none left the card is not drawn at all — and it is never drawn for somebody the venue
// does not show Orders to, nor before the server has answered (useOrdersDue, called by the Home, which lays the page out by it).
// Short words only: a title and the names.
//
// ⚠️ A ROW CAN GO UNDER A KEYBOARD'S FOCUS (another phone placed that order): the focus then goes to the card's title, or — when the
// last row went and the card with it — to «Da fare»'s title, never to the top of the page.
export function OrdersDueCard({ due }: { due: readonly StoredDoc[] }) {
  const { t } = useT();
  const inside = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const shown = due.length > 0;
  useLayoutEffect(() => {
    // With the card gone there is no title: the effect below hands the focus on.
    if (!inside.current || !shown) return;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    inside.current = false;
    title.current?.focus();
  }, [due]);
  // The card going away entirely: its node is gone, so the focus is handed on after the commit.
  useEffect(() => {
    if (shown || !inside.current) return;
    inside.current = false;
    const now = document.activeElement;
    if (now === null || now === document.body) document.getElementById('home-todo-title')?.focus();
  }, [shown]);
  if (!shown) return null;
  return (
    <section
      className={styles.card}
      aria-labelledby="home-orders-due-title"
      onFocus={() => { inside.current = true; }}
      onBlur={event => { if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget as Node)) inside.current = false; }}
    >
      <h2 ref={title} id="home-orders-due-title" tabIndex={-1} className={styles.title}>{t('home.ordersDue.title')}</h2>
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
