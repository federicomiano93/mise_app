import { useEffect } from 'react';
import { OrdersDueCard } from './OrdersDueCard';
import { useOrdersDue } from './useOrdersDue';

// The Home's «Ordini da fare» part: it owns the card's data (useOrdersDue), so a draft snapshot from another phone redraws only
// this part, never the Home, and a failure in the hook is caught by the PartBoundary around it, not by the page.
// It tells the Home only WHETHER the card is drawn (the Home lays out two columns by it): the callback runs when that changes.
export function OrdersDuePart({ onShownChange }: { onShownChange: (shown: boolean) => void }) {
  const due = useOrdersDue();
  const shown = due.length > 0;
  useEffect(() => {
    onShownChange(shown);
    return () => { onShownChange(false); };
  }, [shown, onShownChange]);
  return <OrdersDueCard due={due} />;
}
