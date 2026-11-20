import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import { localNumber } from '@mise/shared/currency';
import { NumberBox } from '../foodcost/NumberBox';
import { cameFromList, useLeave } from '../foodcost/foodcostNav';
import { SETTINGS_OPENER, useHandBack } from '../foodcost/handBack';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useCakes, useCakesStore } from './CakesContext';
import { CAKES_PATH } from './cakesPath';
import { CAKE_FIELDS, GRAM_FIELDS, exampleGrams, firstProblem, isDirty, referenceFrom, textFrom } from './referenceModel';
import type { ReferenceField, ReferenceKey, ReferenceText } from './referenceModel';
import styles from './ReferenceScreen.module.css';

// The venue's reference grams: the grams of one cake the venue makes often, from which every new cake starts (scaled to its own size).
//
// ⚠️ EVERYONE WHO SEES CAKES READS THIS SCREEN; ONLY WHOEVER RUNS THE PLACE (`canManage`) CAN CHANGE IT. The rules refuse everybody
// else's write, so an employee gets the figures as plain text and no Save: no box that would accept typing and then say «refused».
//
// ⚠️ THE FORM WAITS FOR THE STORED FIGURES (`referenceLoaded`): opened by its address, they may not have arrived, and a box copied
// now would be empty — a Save would write the venue's reference over the real one.
export function ReferenceScreen() {
  const { t } = useT();
  const { referenceLoaded } = useCakes();
  if (!referenceLoaded) {
    return (
      <section className={styles.screen} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <Reference />;
}

function Reference() {
  const { canManage } = useSession();
  return canManage ? <ReferenceForm /> : <ReferenceRead />;
}

const unitText = (t: ReturnType<typeof useT>['t'], field: ReferenceField): string => {
  if (field.unit === 'cm') return t('cakes.ref.unitCm');
  return field.unit === 'g' ? t('cakes.ref.unitG') : '';
};

// ── Somebody who may not change it: the figures, as text ─────────────────────────────────────────────────────────────────

function ReferenceRead() {
  const { t } = useT();
  const money = useMoney();
  const { reference } = useCakes();
  const handBack = useHandBack();
  const { state } = useLocation();
  const ids = useId();
  const titleId = `${ids}-title`;
  const title = useRef<HTMLHeadingElement>(null);
  const onLeaving = useCallback(() => { handBack.expect(SETTINGS_OPENER); }, [handBack]);
  const leave = useLeave(CAKES_PATH, onLeaving);
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const shown = (field: ReferenceField) => {
    if (!reference) return '—';
    const value = localNumber(String(reference[field.key]), money, false);
    const unit = unitText(t, field);
    return unit === '' ? value : `${value} ${unit}`;
  };
  const example = exampleGrams(textFrom(reference));

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('cakes.ref.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <p className={styles.note}>{reference ? t('cakes.ref.readOnly') : `${t('cakes.ref.none')} ${t('cakes.ref.readOnly')}`}</p>
        <section className={styles.card} aria-labelledby={`${ids}-cake`}>
          <h3 id={`${ids}-cake`} className={styles.cardTitle}>{t('cakes.ref.cakeTitle')}</h3>
          <dl className={styles.grid}>
            {CAKE_FIELDS.map(field => <ReadRow key={field.key} field={field} value={shown(field)} />)}
          </dl>
        </section>
        <section className={styles.card} aria-labelledby={`${ids}-grams`}>
          <h3 id={`${ids}-grams`} className={styles.cardTitle}>{t('cakes.ref.gramsTitle')}</h3>
          <dl className={styles.grid}>
            {GRAM_FIELDS.map(field => <ReadRow key={field.key} field={field} value={shown(field)} />)}
          </dl>
          <p className={styles.hint}>{t('cakes.ref.howScales')}</p>
          <p className={styles.hint}>{t('cakes.ref.coatingApprox')}</p>
        </section>
        <Example grams={example} idPrefix={ids} />
      </div>
    </section>
  );
}

function ReadRow({ field, value }: { field: ReferenceField; value: string }) {
  const { t } = useT();
  return (
    <div className={styles.row}>
      <dt className={styles.labelText}>
        <b>{t(field.label)}</b>
        <span>{t(field.sub)}</span>
      </dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}

function Example({ grams, idPrefix }: { grams: ReturnType<typeof exampleGrams>; idPrefix: string }) {
  const { t } = useT();
  const money = useMoney();
  return (
    <section className={styles.card} aria-labelledby={`${idPrefix}-try`}>
      <h3 id={`${idPrefix}-try`} className={styles.cardTitle}>{t('cakes.ref.tryTitle')}</h3>
      {grams === null ? (
        <p className={styles.hint}>{t('cakes.ref.tryNone')}</p>
      ) : (
        <ul className={styles.example}>
          {grams.map(row => (
            <li key={row.part}>
              <span>{t(row.label)}</span>
              <b className={styles.figure}>{localNumber(String(Math.round(row.grams)), money)} {t('cakes.ref.unitG')}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Whoever runs the place: the form ─────────────────────────────────────────────────────────────────────────────────────

// ⚠️ EVERYTHING HAPPENS ON A WORKING COPY (P20): nothing is saved until Save is pressed and confirmed, and leaving with a changed
// number asks first. The stored figures are read once, when the form opens: a colleague's change never rewrites a box somebody is
// typing in.
function ReferenceForm() {
  const { t } = useT();
  const store = useCakesStore();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const ids = useId();
  const titleId = `${ids}-title`;

  const [stored] = useState<ReferenceGrams | null>(() => store.getSnapshot().reference);
  const [text, setText] = useState<ReferenceText>(() => textFrom(stored));
  const [invalidKey, setInvalidKey] = useState<ReferenceKey | null>(null);
  const inputs = useRef(new Map<ReferenceKey, HTMLInputElement>());
  const title = useRef<HTMLHeadingElement>(null);

  // ⚠️ DIRTY IS «A BOX DIFFERS FROM THE STORED FIGURE», also kept in a ref: the router's blocker reads it at the moment of a
  // navigation, and a state value read there could be one render behind.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const setDirtyBoth = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const onLeaving = useCallback(() => { handBack.expect(SETTINGS_OPENER); }, [handBack]);
  const leave = useLeave(CAKES_PATH, onLeaving);
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const discardQuestion = () => confirm({
    title: t('fc.discardChanges'),
    message: t('fc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // Every way out goes through the router's blocker (the rail, a cake picked in the list, the browser's Back); the Back button asks for
  // itself first, because its navigate(-1) is a POP the blocker cannot stop on an entry it did not create (FoodcostSettings).
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          current.proceed();
        } else {
          handBack.forget();
          current.reset();
        }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  async function back() {
    if (asking.current || askingLeave.current) return;
    if (dirtyRef.current) {
      asking.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        asking.current = false;
      }
      setDirtyBoth(false);
    }
    leave();
  }

  async function save() {
    if (asking.current || askingLeave.current) return;
    // ⚠️ AN EMPTY OR OUT-OF-BOUNDS BOX BLOCKS THE SAVE (P20): the first one is highlighted and takes the focus, and the message names
    // it. Asked BEFORE «Save?», so a number the rules would refuse never reads «saved».
    const problem = firstProblem(text);
    if (problem !== null) {
      setInvalidKey(problem.key);
      inputs.current.get(problem.key)?.focus();
      const field = t(problem.field.label);
      say(problem.kind === 'empty'
        ? t('cakes.ref.empty', { field })
        : t(problem.kind === 'whole' ? 'cakes.ref.whole' : 'cakes.ref.range', {
          field, min: localNumber(String(problem.field.min), money, false), max: localNumber(String(problem.field.max), money),
        }));
      return;
    }
    const grams = referenceFrom(text);
    if (!grams) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('cakes.ref.saveQ'),
        message: t('fc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }
    // Local-first: the store moves at once; a refusal puts the grams back and says so (CakesMessage 'reference-not-saved').
    setDirtyBoth(false);
    store.saveReference(grams);
    say(t('cakes.ref.saved'));
    leave();
  }

  const setBox = (key: ReferenceKey, value: string) => {
    const next = { ...text, [key]: value };
    setText(next);
    setInvalidKey(null);
    setDirtyBoth(isDirty(next, stored));
  };

  const box = (field: ReferenceField) => {
    const id = `${ids}-${field.key}`;
    return (
      <div key={field.key} className={styles.row}>
        <label htmlFor={id} className={styles.labelText}>
          <b>{t(field.label)}</b>
          <span>{t(field.sub)}</span>
        </label>
        <div className={styles.boxCell}>
          <NumberBox
            id={id}
            value={text[field.key]}
            invalid={invalidKey === field.key}
            inputRef={node => { if (node) inputs.current.set(field.key, node); else inputs.current.delete(field.key); }}
            onChange={value => { setBox(field.key, value); }}
          />
          <span className={styles.unit}>{unitText(t, field)}</span>
        </div>
      </div>
    );
  };

  const example = exampleGrams(text);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('cakes.ref.title')}
        titleId={titleId}
        titleRef={title}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />
      <div className={styles.body}>
        <section className={styles.card} aria-labelledby={`${ids}-cake`}>
          <h3 id={`${ids}-cake`} className={styles.cardTitle}>{t('cakes.ref.cakeTitle')}</h3>
          <p className={styles.hint}>{t('cakes.ref.cakeIntro')}</p>
          <div className={styles.grid}>{CAKE_FIELDS.map(box)}</div>
        </section>
        <section className={styles.card} aria-labelledby={`${ids}-grams`}>
          <h3 id={`${ids}-grams`} className={styles.cardTitle}>{t('cakes.ref.gramsTitle')}</h3>
          <div className={styles.grid}>{GRAM_FIELDS.map(box)}</div>
          <p className={styles.hint}>{t('cakes.ref.howScales')}</p>
          <p className={styles.hint}>{t('cakes.ref.coatingApprox')}</p>
        </section>
        <Example grams={example} idPrefix={ids} />
      </div>
      {confirmDialog}
    </section>
  );
}
