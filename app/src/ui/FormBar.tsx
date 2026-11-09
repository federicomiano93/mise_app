import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import styles from './FormBar.module.css';

type Props = {
  // The Back button's name («Back»): the words belong to the caller's language, not to this file.
  backLabel: string;
  onBack: () => void;
  // Back does nothing for now (a bulk write is in the air and cannot be put back by leaving): the button is drawn off.
  backDisabled?: boolean;
  // The screen's name, an h2: the page's own h1 is the section («Pastries»).
  title: string;
  // Lets the screen's region be named by it (aria-labelledby).
  titleId?: string;
  // Lets the screen put the focus on its title when it opens.
  titleRef?: Ref<HTMLHeadingElement>;
  // Makes the title a door: a button inside the h2 (which stays the focus target) with a chevron after the name. `titleDoorLabel` is
  // the button's accessible name: it holds the visible name AND says where the door goes (WCAG 2.5.3, label in name). The h2 and the
  // screen are still named by the visible name alone (`titleId` sits on the name's own span).
  onTitle?: () => void;
  titleDoorLabel?: string;
  titleDoorRef?: Ref<HTMLButtonElement>;
  // Under the title: «Last 15 days», or «Unsaved changes». The caller styles it.
  sub?: ReactNode;
  // The one primary action, always here at the top (P20): Save.
  action?: ReactNode;
};

// The bar at the top of a screen one level down (the design's `.form-bar`): Back · title · the one
// primary action. It sticks to the top of the scrolling area, so Save never scrolls out of reach
// of a long form.
export function FormBar({ backLabel, onBack, backDisabled = false, title, titleId, titleRef, onTitle, titleDoorLabel, titleDoorRef, sub, action }: Props) {
  const ownNameId = useId();
  const nameId = titleId ?? ownNameId;
  return (
    <header className={styles.bar}>
      <Button className={styles.back} aria-label={backLabel} onPress={onBack} isDisabled={backDisabled}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div className={styles.text}>
        {onTitle ? (
          // ⚠️ THE NAME IS WHAT THE HEADING AND THE SCREEN ARE CALLED: the button's longer name would otherwise become theirs.
          <h2 ref={titleRef} tabIndex={-1} className={styles.title} aria-labelledby={nameId}>
            <button ref={titleDoorRef} type="button" className={styles.door} aria-label={titleDoorLabel} onClick={onTitle}>
              <span id={nameId} className={styles.doorText}>{title}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </h2>
        ) : (
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className={styles.title}>{title}</h2>
        )}
        {sub}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  );
}
