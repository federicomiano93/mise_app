import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { LeaveStep } from './useLeaveFlow';

type Props = {
  flow: LeaveStep;
  // The first step: the caller's own question.
  role: 'dialog' | 'alertdialog';
  title: string;
  message?: string;
  children?: ReactNode;
  actions: ReactNode;
};

// The dialog of useLeaveFlow: the caller's question first, then «Not sent yet» in the same
// dialog. The two steps' buttons carry different keys, so React builds NEW buttons for the
// second step — which is what lets «Stay» take the focus the moment it appears.
export function LeaveDialog({ flow, role, title, message, children, actions }: Props) {
  const { t } = useT();

  if (flow.step === 'unsent') {
    return (
      <Dialog
        isOpen
        onClose={flow.close}
        role="alertdialog"
        title={t('unsent.title')}
        message={t('unsent.message')}
        actions={
          <>
            <Button key="stay" variant="primary" autoFocus onPress={flow.close}>{t('unsent.stay')}</Button>
            <Button key="leave" variant="danger" onPress={flow.goOn}>{t('unsent.leave')}</Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      isOpen={flow.step === 'ask'}
      onClose={flow.close}
      role={role}
      title={title}
      message={message}
      actions={actions}
    >
      {children}
    </Dialog>
  );
}
