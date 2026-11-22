import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { MAX_STANDARD_ROWS, standardCell } from '@mise/shared/cake-standard';
import type { StandardColumn } from '@mise/shared/cake-standard';
import { localNumber } from '@mise/shared/currency';
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
import { useCopyWait } from '../foodcost/copyWait';
import {
  COLUMN_WORDS, DIAMETER_MAX, DIAMETER_MIN, GRAMS_MAX, GRAMS_MIN, SHAPE_FIELDS, addDiameter, firstProblem, isDirty, previewOf, removeDiameter,
  setCell, standardFrom, textFrom,
} from './referenceModel';
import type { ShapeKey, TableText } from './referenceModel';
import styles from './ReferenceScreen.module.css';

// The venue's standard cake: a TABLE OF GRAMS PER DIAMETER. An empty box shows, grey, the figure worked out from the nearest diameter
// where somebody typed their own; a new cake starts from the row at its own diameter.
//
// ⚠️ EVERYONE WHO SEES CAKES READS THIS SCREEN; ONLY WHOEVER RUNS THE PLACE (`canManage`) CAN CHANGE IT. The rules refuse everybody
// else's write, so an employee gets the table as plain text and no Save: no box that would accept typing and then say «refused».
//
// ⚠️ THE FORM WAITS FOR THE STORED TABLE (`referenceLoaded`): opened by its address, it may not have arrived, and a copy made now would
// be the empty table — a Save would write it over the venue's real one.
export function ReferenceScreen() {
  const { t } = useT();
  const { referenceLoaded } = useCakes();
  // After the deadline (offline on a first visit nothing ever answers) the form opens empty, as for a venue with none yet.
  const waited = useCopyWait(referenceLoaded);
  if (!waited) {
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

// ── Somebody who may not change it: the table, as text ───────────────────────────────────────────────────────────────────

function ReferenceRead() {
  const { t } = useT();
  const money = useMoney();
  const { standard } = useCakes();
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

  // ⚠️ PLAIN DIGITS (1050, never 1.050 / 1,050): the boxes read a dot or a comma as a decimal point, so the figures beside them must not
  // teach the other reading.
  const grams = (value: number) => t('cakes.grams', { g: String(value) });

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('cakes.ref.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <p className={styles.note}>{standard ? t('cakes.ref.readOnly') : `${t('cakes.ref.none')} ${t('cakes.ref.readOnly')}`}</p>
        {standard && (
          <section className={styles.card} aria-labelledby={`${ids}-cake`}>
            <h3 id={`${ids}-cake`} className={styles.cardTitle}>{t('cakes.ref.cakeTitle')}</h3>
            <p className={styles.hint}>{t('cakes.ref.cakeIntro')}</p>
            <dl className={styles.shape}>
              <div className={styles.shapeRow}>
                <dt className={styles.shapeLabel}>{t('cakes.ref.discs')}</dt>
                <dd className={styles.figure}>{localNumber(String(standard.discs), money, false)}</dd>
              </div>
              <div className={styles.shapeRow}>
                <dt className={styles.shapeLabel}>{t('cakes.ref.discHeight')}</dt>
                <dd className={styles.figure}>{localNumber(String(standard.discHeightCm), money, false)} {t('cakes.ref.unitCm')}</dd>
              </div>
            </dl>
            <div className={styles.table} role="group" aria-label={t('cakes.ref.tableLabel')}>
              <ColumnHeads />
              {standard.rows.map(row => (
                <div key={row.diameterCm} className={styles.row} role="group" aria-labelledby={`${ids}-r${row.diameterCm}`}>
                  <span id={`${ids}-r${row.diameterCm}`} className={styles.rowTitle}>{t('cakes.ref.rowTitle', { d: row.diameterCm })}</span>
                  <div className={styles.cells}>
                    {COLUMN_WORDS.map(words => {
                      const cell = standardCell(standard, words.column, row.diameterCm);
                      return (
                        <div key={words.column} className={styles.cell}>
                          <span className={styles.cellLabel}><b>{t(words.label)}</b> · {t(words.sub)}</span>
                          {cell ? (
                            <p className={cell.typed ? styles.figure : `${styles.figure} ${styles.figureComputed}`}>
                              {grams(cell.grams)}
                              {!cell.typed && <span className="visually-hidden"> {t('cakes.ref.computed')}</span>}
                            </p>
                          ) : <p className={styles.figure}>—</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className={styles.hint}>{t('cakes.ref.howScales')}</p>
            <p className={styles.hint}>{t('cakes.ref.coatingApprox')}</p>
          </section>
        )}
      </div>
    </section>
  );
}

// The header row of the wide table. Hidden from a screen reader: every box and every figure carries its full name.
function ColumnHeads() {
  const { t } = useT();
  return (
    <div className={styles.head} aria-hidden="true">
      <span>{t('cakes.ref.diameter')}</span>
      {COLUMN_WORDS.map(words => (
        <span key={words.column}><b>{t(words.label)}</b>{t(words.sub)}</span>
      ))}
      <span />
    </div>
  );
}

// ── A box with its unit inside ───────────────────────────────────────────────────────────────────────────────────────────

type BoxProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  unit: string;
  invalid: boolean;
  inputMode: 'decimal' | 'numeric';
  // Read aloud after the name: the column's note («g per disc») and a grey figure's «worked out from 22 cm: 310 g».
  hint?: string;
  note?: string;
  // The id of an element outside the box that also describes it (the «New diameter» error).
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (text: string) => void;
  onEnter?: () => void;
};

// A number typed into a plain text box. ⚠️ A COMMA TYPED IS A DECIMAL POINT (referenceModel.readNumber): the text is kept as typed.
function Box({ id, label, value, placeholder, unit, invalid, inputMode, hint, note, describedBy, inputRef, onChange, onEnter }: BoxProps) {
  const hintId = `${id}-hint`;
  const noteId = `${id}-note`;
  const described = [note ? noteId : null, hint ? hintId : null, describedBy ?? null].filter(Boolean).join(' ');
  return (
    <span className={styles.box} data-invalid={invalid}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        className={styles.input}
        aria-label={label}
        aria-describedby={described === '' ? undefined : described}
        aria-invalid={invalid ? true : undefined}
        placeholder={placeholder}
        value={value}
        onChange={event => { onChange(event.target.value); }}
        onKeyDown={onEnter ? event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onEnter();
          }
        } : undefined}
      />
      {unit !== '' && <span className={styles.unit} aria-hidden="true">{unit}</span>}
      {note && <span id={noteId} className="visually-hidden">{note}</span>}
      {hint && <span id={hintId} className="visually-hidden">{hint}</span>}
    </span>
  );
}

// ── Whoever runs the place: the form ─────────────────────────────────────────────────────────────────────────────────────

type Invalid =
  | { kind: 'shape'; key: ShapeKey }
  | { kind: 'cell'; diameterCm: number; column: StandardColumn }
  | null;

const cellKey = (diameterCm: number, column: StandardColumn) => `cell:${diameterCm}:${column}`;

// ⚠️ EVERYTHING HAPPENS ON A WORKING COPY (P20): nothing is saved until Save is pressed and confirmed, and leaving with a changed
// number asks first. The stored table is read once, when the form opens: a colleague's change never rewrites a box somebody is typing in.
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

  const [stored] = useState(() => store.getSnapshot().standard);
  const [text, setText] = useState<TableText>(() => textFrom(stored));
  const [invalid, setInvalid] = useState<Invalid>(null);
  const [newDiameter, setNewDiameter] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addInvalid, setAddInvalid] = useState(false);
  // The box that takes the focus once the next render has drawn it (a new row, a removed row).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const title = useRef<HTMLHeadingElement>(null);

  // ⚠️ DIRTY IS «THE COPY DIFFERS FROM THE STORED TABLE», also kept in a ref: the router's blocker reads it at the moment of a
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

  useEffect(() => {
    if (focusKey === null) return;
    elements.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const register = (key: string) => (node: HTMLElement | null) => {
    if (node) elements.current.set(key, node);
    else elements.current.delete(key);
  };

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

  const names = (diameterCm: number, column: StandardColumn) => {
    const words = COLUMN_WORDS.find(w => w.column === column);
    return t('cakes.ref.cellName', { part: t(words ? words.label : 'cakes.part.base'), d: diameterCm });
  };
  const thousands = (value: number) => localNumber(String(value), money);
  // The grey figures: plain digits, see ReferenceRead.
  const plain = (value: number) => String(value);

  async function save() {
    if (asking.current || askingLeave.current) return;
    // ⚠️ A BOX THAT CANNOT BE SAVED BLOCKS THE SAVE (P20): the first one is highlighted and takes the focus, and the message names it.
    // Asked BEFORE «Save?», so a number the rules would refuse never reads «saved».
    const problem = firstProblem(text);
    if (problem !== null) {
      if ('field' in problem) {
        setInvalid({ kind: 'shape', key: problem.field.key });
        elements.current.get(`shape:${problem.field.key}`)?.focus();
        const field = t(problem.field.label);
        say(problem.kind === 'empty'
          ? t('cakes.ref.empty', { field })
          : t(problem.kind === 'whole' ? 'cakes.ref.whole' : 'cakes.ref.range', {
            field, min: localNumber(String(problem.field.min), money, false), max: localNumber(String(problem.field.max), money),
          }));
      } else {
        setInvalid({ kind: 'cell', diameterCm: problem.diameterCm, column: problem.column });
        elements.current.get(cellKey(problem.diameterCm, problem.column))?.focus();
        if (problem.kind === 'cell') {
          say(t('cakes.ref.range', {
            field: names(problem.diameterCm, problem.column),
            min: localNumber(String(GRAMS_MIN), money, false),
            max: thousands(GRAMS_MAX),
          }));
        } else {
          const words = COLUMN_WORDS.find(w => w.column === problem.column);
          say(t('cakes.ref.columnEmpty', { field: t(words ? words.label : 'cakes.part.base') }));
        }
      }
      return;
    }
    const standard = standardFrom(text);
    if (!standard) return;
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
    // Local-first: the store moves at once; a refusal puts the table back and says so (CakesMessage 'reference-not-saved').
    setDirtyBoth(false);
    store.saveStandard(standard);
    say(t('cakes.ref.saved'));
    leave();
  }

  const change = (next: TableText) => {
    setText(next);
    setInvalid(null);
    setDirtyBoth(isDirty(next, stored));
  };

  function add() {
    const result = addDiameter(text, newDiameter);
    if (!result.ok) {
      setAddInvalid(true);
      if (result.error === 'duplicate') setAddError(t('cakes.ref.diameterDup', { d: result.diameterCm ?? 0 }));
      else if (result.error === 'full') setAddError(t('cakes.ref.maxRows', { n: MAX_STANDARD_ROWS }));
      else setAddError(t('cakes.ref.diameterRange', { min: DIAMETER_MIN, max: DIAMETER_MAX }));
      elements.current.get('add')?.focus();
      return;
    }
    setAddInvalid(false);
    setAddError(null);
    setNewDiameter('');
    change(result.text);
    setFocusKey(cellKey(result.diameterCm, 'baseG'));
  }

  function remove(diameterCm: number) {
    if (text.rows.length <= 1) return;
    const index = text.rows.findIndex(row => row.diameterCm === diameterCm);
    // The next row's ×, else the previous one's. ⚠️ When only ONE row is left its × is disabled and cannot take the focus: its first box
    // does, so the focus never falls to the page.
    const neighbour = text.rows[index + 1] ?? text.rows[index - 1];
    change(removeDiameter(text, diameterCm));
    if (!neighbour) setFocusKey('add');
    else setFocusKey(text.rows.length <= 2 ? cellKey(neighbour.diameterCm, 'baseG') : `remove:${neighbour.diameterCm}`);
  }

  const preview = previewOf(text);
  const full = text.rows.length >= MAX_STANDARD_ROWS;

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
          <div className={styles.shape}>
            {SHAPE_FIELDS.map(field => {
              const id = `${ids}-${field.key}`;
              return (
                <div key={field.key} className={styles.shapeRow}>
                  <label htmlFor={id} className={styles.shapeLabel}>{t(field.label)}</label>
                  <span className={styles.shapeBox}>
                    <Box
                      id={id}
                      label={t(field.label)}
                      value={text[field.key]}
                      placeholder="0"
                      unit={field.unit === 'cm' ? t('cakes.ref.unitCm') : ''}
                      invalid={invalid?.kind === 'shape' && invalid.key === field.key}
                      inputMode={field.whole ? 'numeric' : 'decimal'}
                      inputRef={register(`shape:${field.key}`)}
                      onChange={value => { change({ ...text, [field.key]: value }); }}
                    />
                  </span>
                </div>
              );
            })}
          </div>

          <div className={styles.table} role="group" aria-label={t('cakes.ref.tableLabel')}>
            <ColumnHeads />
            {text.rows.map(row => (
              <div key={row.diameterCm} className={styles.row} role="group" aria-labelledby={`${ids}-r${row.diameterCm}`}>
                <span id={`${ids}-r${row.diameterCm}`} className={styles.rowTitle}>{t('cakes.ref.rowTitle', { d: row.diameterCm })}</span>
                <div className={styles.cells}>
                  {COLUMN_WORDS.map(words => {
                    const value = row.cells[words.column];
                    // The grey figure follows what is typed RIGHT NOW (the copy, not the stored table).
                    const cell = value.trim() === '' ? standardCell(preview, words.column, row.diameterCm) : null;
                    const id = `${ids}-${row.diameterCm}-${words.column}`;
                    return (
                      <div key={words.column} className={styles.cell}>
                        <span className={styles.cellLabel} aria-hidden="true"><b>{t(words.label)}</b> · {t(words.sub)}</span>
                        <Box
                          id={id}
                          label={names(row.diameterCm, words.column)}
                          value={value}
                          placeholder={cell ? plain(cell.grams) : '—'}
                          note={t(words.sub)}
                          hint={cell ? t('cakes.ref.cellFrom', { d: cell.fromCm, g: t('cakes.grams', { g: plain(cell.grams) }) }) : undefined}
                          unit={t('cakes.ref.unitG')}
                          invalid={invalid?.kind === 'cell' && invalid.diameterCm === row.diameterCm && invalid.column === words.column}
                          inputMode="decimal"
                          inputRef={register(cellKey(row.diameterCm, words.column))}
                          onChange={next => { change(setCell(text, row.diameterCm, words.column, next)); }}
                        />
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant="bare"
                  className={styles.remove}
                  aria-label={t('cakes.ref.remove', { d: row.diameterCm })}
                  isDisabled={text.rows.length <= 1}
                  ref={register(`remove:${row.diameterCm}`)}
                  onPress={() => { remove(row.diameterCm); }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          <div className={styles.addRow}>
            <div className={styles.addField}>
              <label htmlFor={`${ids}-add`} className={styles.addLabel}>{t('cakes.ref.newDiameter')}</label>
              <Box
                id={`${ids}-add`}
                label={t('cakes.ref.newDiameter')}
                value={newDiameter}
                placeholder={t('cakes.ref.newDiameterHint')}
                unit={t('cakes.ref.unitCm')}
                invalid={addInvalid}
                describedBy={addError ? `${ids}-add-error` : undefined}
                inputMode="numeric"
                inputRef={register('add')}
                onChange={value => {
                  setNewDiameter(value);
                  setAddInvalid(false);
                  setAddError(null);
                }}
                onEnter={add}
              />
            </div>
            <Button isDisabled={full} onPress={add}>
              <Plus aria-hidden="true" />
              {t('cakes.ref.add')}
            </Button>
          </div>
          <p id={`${ids}-add-error`} role="alert" className={styles.error}>{addError ?? ''}</p>
          {full && <p className={styles.hint}>{t('cakes.ref.maxRows', { n: MAX_STANDARD_ROWS })}</p>}

          <p className={styles.hint}>{t('cakes.ref.howScales')}</p>
          <p className={styles.hint}>{t('cakes.ref.coatingApprox')}</p>
        </section>
      </div>
      {confirmDialog}
    </section>
  );
}
