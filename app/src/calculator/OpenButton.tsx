import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../ui/Button';
import { FROM_PARENT } from './calculatorNav';
import { useHandBack } from './handBack';

type Props = {
  // The name it registers under with the hand-back: Back from the screen it opens gives the focus to it.
  opener: string;
  to: string;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
};

// A button of the work view that opens a screen one level down (Settings, the recipe editor).
export function OpenButton({ opener, to, variant = 'secondary', children }: Props) {
  const navigate = useNavigate();
  const handBack = useHandBack();
  const register = useCallback((node: HTMLButtonElement | null) => { handBack.register(opener, node); }, [handBack, opener]);
  return (
    <Button
      ref={register}
      variant={variant}
      onPress={() => {
        handBack.expect(opener);
        void navigate(to, { state: FROM_PARENT });
      }}
    >
      {children}
    </Button>
  );
}
