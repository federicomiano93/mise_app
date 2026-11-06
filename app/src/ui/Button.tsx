import type { Ref } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { ButtonProps } from 'react-aria-components';
import styles from './Button.module.css';

// The app's buttons, one component so every screen's primary, secondary and quiet button look
// and behave alike (React Aria brings the keyboard, the press states and the pending state).
//
//  primary    the one action a screen is for — one per screen
//  secondary  everything else that is a button
//  quiet      a link-style button inside running text or under a form («Forgot your password?»)
//  danger     leaving or throwing something away; outlined, so it never competes with the primary
//  bare       the keyboard and press behaviour, and NO look: the caller's className is all of it
//             (the venue chip, a row in a list)
type Variant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'bare';

const VARIANT: Readonly<Record<Exclude<Variant, 'bare'>, string>> = {
  primary: styles.primary ?? '',
  secondary: styles.secondary ?? '',
  quiet: styles.quiet ?? '',
  danger: styles.danger ?? '',
};

type Props = Omit<ButtonProps, 'className'> & {
  variant?: Variant;
  // Full width and the large touch height: the single action of a gate screen.
  block?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = 'secondary', block = false, className, ...rest }: Props) {
  // ⚠️ A `bare` BUTTON GETS NONE OF THE BASE CLASS: two classes from two modules weigh the same,
  // so whichever stylesheet loads last would win wherever both set, say, min-height.
  const own = variant === 'bare' ? [] : [styles.button, VARIANT[variant], block ? styles.block : ''];
  const classes = [...own, className ?? ''].filter(Boolean).join(' ');
  return <AriaButton {...rest} className={classes} />;
}
