import { useEffect, useRef, useState } from 'react';
import { Share } from 'lucide-react';
import { afterShare } from '@mise/shared/send-chooser';
import type { PhotoOutcome, SendJob } from '@mise/shared/send-chooser';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { sharePhoto } from './orderImage';

// «Photo or text?» — the order as a picture (first, focused) or as the plain text. Escape and Cancel back out of the whole send.
export function FormatDialog({ answer }: { answer: (format: 'photo' | 'text' | null) => void }) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      title={t('ord.sendFormat.title')}
      onClose={() => { answer(null); }}
      actions={<Button onPress={() => { answer(null); }}>{t('common.cancel')}</Button>}
    >
      <Button variant="primary" block autoFocus onPress={() => { answer('photo'); }}>{t('ord.sendFormat.photo')}</Button>
      <Button block onPress={() => { answer('text'); }}>{t('ord.sendFormat.text')}</Button>
    </Dialog>
  );
}

type PhotoProps = {
  job: SendJob;
  file: File | undefined;
  i: number;
  n: number;
  answer: (outcome: PhotoOutcome) => void;
};

// ONE picture, whose own Share button starts the share.
//
// ⚠️ SHARE'S PRESS STARTS share() AT ONCE, with nothing awaited first: the browser lets a page open the share sheet only inside
// a person's tap. While it runs ONLY Share is disabled — Skip, Cancel and Escape stay live, so a sheet that never answers
// cannot trap the person here. A sheet closed without sharing (`again`) puts Share back and gives it the focus; so does coming
// back to the page, because a share sheet that was sent to the background may never resolve.
// ⚠️ THE PARENT'S `answer` SETTLES ONCE (settleOnce): a share() that resolves after Skip is ignored, so a picture the person
// skipped is never counted as sent.
export function PhotoDialog({ job, file, i, n, answer }: PhotoProps) {
  const { t } = useT();
  const [sharing, setSharing] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const wasSharing = useRef(false);

  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') setSharing(false); };
    document.addEventListener('visibilitychange', back);
    return () => { document.removeEventListener('visibilitychange', back); };
  }, []);

  // A disabled button drops the focus on the page: Share gets it back when it is enabled again.
  useEffect(() => {
    if (wasSharing.current && !sharing) shareButton.current?.focus();
    wasSharing.current = sharing;
  }, [sharing]);

  const share = () => {
    if (sharing) return;
    if (!file) {
      answer('failed');
      return;
    }
    setSharing(true);
    void sharePhoto(file).then(result => {
      const after = afterShare(result);
      if (after === 'again') setSharing(false);
      else answer(after);
    });
  };

  const title = job.name ? t('ord.sendFormat.shareFor', { name: job.name, i: i + 1, n }) : t('ord.sendFormat.shareReady');
  return (
    <Dialog
      isOpen
      title={title}
      onClose={() => { answer('cancelled'); }}
      actions={
        <>
          <Button onPress={() => { answer(n > 1 ? 'skipped' : 'cancelled'); }}>
            {n > 1 ? t('ord.sendFormat.skip') : t('common.cancel')}
          </Button>
          <Button ref={shareButton} variant="primary" autoFocus isDisabled={sharing} onPress={share}>
            <Share aria-hidden="true" />
            {t('ord.sendFormat.share')}
          </Button>
        </>
      }
    />
  );
}
