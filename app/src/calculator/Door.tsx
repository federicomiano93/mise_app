import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '../ui/Button';
import { FROM_PARENT } from './calculatorNav';
import { useHandBack } from './handBack';
import styles from './Door.module.css';

type Props = {
  // The name it registers under with the hand-back: Back from the screen it opens gives the focus to it.
  opener: string;
  to: string;
  title: string;
  // A line under the title, when the row needs to say what is behind it.
  sub?: string;
};

// A row that opens a screen one level down.
export function Door({ opener, to, title, sub }: Props) {
  const navigate = useNavigate();
  const handBack = useHandBack();
  const register = useCallback((node: HTMLButtonElement | null) => { handBack.register(opener, node); }, [handBack, opener]);
  return (
    <Button
      ref={register}
      variant="bare"
      className={styles.door}
      onPress={() => {
        handBack.expect(opener);
        void navigate(to, { state: FROM_PARENT });
      }}
    >
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {sub === undefined ? null : <span className={styles.sub}>{sub}</span>}
      </span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}
