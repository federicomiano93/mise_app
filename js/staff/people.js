// people.js — "Who can get in": the owner's list of everybody in this location,
// what each of them may do, and the six-digit code that adds one more.
//
// ⚠️ IT IS AN OVERLAY ON THE HOME, NOT A PAGE OF ITS OWN, and that is a decision
// worth keeping. A new page would need a name in js/sections.js — and a section
// missing from a location document defaults to ON, so adding one turns it on for
// every venue that already exists and needs `sections.<name>: false` typed into
// each of them in the console before the release lands. This screen needs none
// of that: it is reached from the Home, it is drawn only for an owner, and the
// functions behind it refuse anybody else regardless of what is on screen.
//
// Follows the app's header spec: Back on the LEFT, title CENTRED, nothing on the
// right — there is no save here, every action applies as it is confirmed.

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import {
  watchMembers, createJoinCode, setMemberRole, setMemberName, callFailureText,
} from './firebase-staff.js';
import { joinLinkFor, expiresInWords } from '../join-link.js';
import { copyToClipboard } from '../share.js';
import { chooseHowToSend } from '../send-sheet.js';
import { SEND_PATHS, svgElement } from '../send-icon.js';
import {
  ROLE_CHOICES, personLabel, personLabelInSentence, choiceKey,
  choiceLabel, choiceLabelInSentence,
} from '../roles.js';
import { t } from '../i18n.js';
import { nameProblem, cleanName } from '../credentials.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// What each role means, in the words the person reading this screen would use.
//
// ⚠️ THESE SENTENCES ARE THE ONLY PLACE ANYBODY IS EVER TOLD what a role does.
// Nothing else in the app explains it, so a wrong one here is a wrong decision
// about a real person's access — made confidently, because the screen said so.
// ⚠️ KEYED BY THE CHOICE, NOT BY THE ROLE, because two choices share one role.
// "Head chef" has to state plainly that it is the manager level under another
// name — four choices with four different-sounding sentences would read as four
// levels of power, and somebody would pick between them believing it mattered.
// ⚠️ KEYS, NOT WORDS, AND LOOKED UP AT DRAW TIME. These are module-level tables:
// a translated sentence written here would be fixed at import — the language the
// app happened to start in, never changing again however often somebody switched
// the setting. Same reason ROLE_CHOICES carries a labelKey (js/roles.js).
const ROLE_MEANS = {
  owner: 'role.means.owner',
  manager: 'role.means.manager',
  'head-chef': 'role.means.headChef',
  staff: 'role.means.staff',
};

// ⚠️ THE WHOLE SENTENCE PER ROLE, NOT A TEMPLATE WITH AN ARTICLE IN IT. English
// needs «an owner», «a manager», «the head chef»; Italian needs no article at all
// («Rendere Marco titolare?»). A hole for the article would be a hole no Italian
// translator can fill, and it would force one to exist. Where two languages
// differ in STRUCTURE and not merely in words, each case gets its own sentence.
const CONFIRM_TITLE = {
  owner: 'people.confirm.owner',
  manager: 'people.confirm.manager',
  'head-chef': 'people.confirm.headChef',
  staff: 'people.confirm.staff',
};

// A person's name, falling back honestly rather than inventing one. The four
// accounts made by hand in the Firebase console have no name at all, and saying
// so is what tells the owner there is something to fix.
function displayName(person) {
  const full = [cleanName(person.firstName), cleanName(person.lastName)]
    .filter(Boolean).join(' ');
  return full || t('people.noNameYet');
}

// ⚠️ IT TAKES THE WHOLE SESSION, not just a uid, and the reason is the WhatsApp
// message: an invitation that says only "open this link" is indistinguishable
// from every scam that has ever been sent over WhatsApp. It has to name the place
// the person is being let into, and `session.name` is where that name lives.
// openLanguage(session) next to it already had this shape.
export function openPeople(session) {
  const myUid = session && session.user && session.user.uid;
  const venueName = (session && session.name) || '';

  let members = [];
  let stop = null;
  let pending = null;      // the invitation being shown, if any
  // Which role the next code will invite as. It starts at Employee — the least
  // power — so a distracted tap grants nothing.
  let newChoice = ROLE_CHOICES.find(c => c.key === 'staff');
  let renaming = null;     // the uid whose row is currently two input boxes

  // ⚠️ TWO SEPARATE CARDS, in the settings kit (.set-section), because the screen
  // answers two different questions: "who do I let in?" and "who is in already?".
  // One long stack of both was what the owner found unclear.
  const list = el('div', { class: 'people-roster' });
  const codeBox = el('div', { class: 'set-block' });
  const membersTitle = el('h3');
  // Hidden while a link or a code is on screen: those carry their own instructions,
  // and two paragraphs of directions above six digits is one too many.
  const inviteIntro = el('p', { text: t('people.invite.intro') });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: close,
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [el('h1', { text: t('people.title') })]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('div', { class: 'people-scroll' }, [
      el('section', { class: 'set-section' }, [
        el('div', { class: 'set-head' }, [
          el('h3', { text: t('people.section.invite') }),
          inviteIntro,
        ]),
        codeBox,
      ]),
      el('section', { class: 'set-section' }, [
        el('div', { class: 'set-head' }, [membersTitle]),
        list,
      ]),
    ]),
  ]);

  function close() {
    if (stop) stop();
    overlay.remove();
  }

  // ── Choosing a role ────────────────────────────────────────────────────────
  //
  // ⚠️ A SELECT PER PERSON, NOT A TWO-WAY TOGGLE AND NOT A BLOCK OF BUTTONS. With
  // three roles a single button saying "Make owner" cannot express where somebody
  // is going, and a toggle that cycles puts a real person's access one mis-tap
  // away from a role nobody chose. Every option states its destination; picking
  // one changes NOTHING by itself — the confirmation (change() below) does — and
  // cancelling puts the select back on the role the person really holds, so what
  // the screen shows is never a role the server has not been told about. Four
  // buttons per member was also what made this screen read as a wall.
  // ⚠️ FOUR WORDS, THREE LEVELS OF POWER. "Manager" and "Head chef" are the same
  // level under two names — Federico's own words for it since 11 Aug, and the
  // reason it is a title rather than a fourth role is in js/roles.js. The
  // confirmation below has to say so out loud, or four options read as four levels.
  // ⚠️ NATIVE, so the phone draws its own picker and the keyboard works untouched.
  // One <option> per ROLE_CHOICES entry, the single list the whole app shares.
  function roleSelect(currentKey, extra) {
    const select = el('select', { class: 'set-select', ...extra });
    for (const choice of ROLE_CHOICES) {
      const option = el('option', { value: choice.key }, choiceLabel(choice));
      option.selected = choice.key === currentKey;
      select.appendChild(option);
    }
    select.value = currentKey;
    return select;
  }

  // ⚠️ ON A COMPUTER, AN ARROW KEY ON A CLOSED SELECT IS ALREADY A CHOICE. Chrome and
  // Edge on Windows fire `change` at every ArrowUp/Down, Home/End, PageUp/Down and
  // typed letter — measured. On a roster select that opened «Make Marco a head chef?»
  // at the first keystroke, so an owner arrowing towards Owner could never get past
  // the neighbouring role, and an Enter out of habit confirmed the wrong one (WCAG
  // 3.2.2, P18). Those keys open the list instead, where moving changes nothing until
  // a role is picked. Phones draw their own picker and never see this.
  const STEP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  function pickFromOpenList(event) {
    const typed = event.key && event.key.length === 1 && event.key !== ' ';
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!STEP_KEYS.has(event.key) && !typed) return;
    event.preventDefault();
    try { event.currentTarget.showPicker(); } catch { /* an old browser: Space and Alt+Down still open it */ }
  }

  // ── The list ───────────────────────────────────────────────────────────────

  function paint() {
    // ⚠️ THE ROSTER IS REBUILT ON EVERY CHANGE — including the one this screen just
    // made, since the server rewrites the member's document. Without this, the
    // select the confirmation handed focus back to is gone and a keyboard or
    // screen-reader user lands at the top of the page (same fix as home-cards-screen).
    const focused = document.activeElement;
    const focusUid = focused && list.contains(focused) && focused.dataset ? focused.dataset.uid : null;
    list.textContent = '';

    // The count is read at every paint: the roster arrives after the screen is
    // drawn and changes while it is open. Without one (failed read, nobody yet)
    // the title simply has no number rather than saying "0".
    membersTitle.textContent = members && members.length
      ? t('people.section.members', { n: members.length })
      : t('people.section.membersPlain');

    if (members === null) {
      list.appendChild(el('p', { class: 'people-empty', text:
        t('people.err.read') }));
      return;
    }

    // Most power first, then alphabetically by name: the question this screen is
    // usually opened to answer is "who can delete things", and that should not
    // need scrolling for.
    const rank = r => (r === 'owner' ? 0 : r === 'manager' ? 1 : 2);
    const sorted = [...members].sort((a, b) =>
      rank(a.role) - rank(b.role) || displayName(a).localeCompare(displayName(b)));

    for (const person of sorted) {
      const isMe = person.uid === myUid;

      if (renaming === person.uid) {
        list.appendChild(renameRow(person));
        continue;
      }

      const main = el('div', { class: 'people-row-main' }, [
        el('span', { class: 'people-name', text: displayName(person) + (isMe ? t('people.you') : '') }),
        el('span', { class: 'people-email', text: person.email || t('people.noEmailParen') }),
      ]);
      const row = el('div', { class: 'people-member' }, [main]);

      // ⚠️ NO CONTROLS ON YOUR OWN ROW. Demoting yourself is the one action here
      // that cannot be undone by the person who took it — you would need somebody
      // else to put you back — so the controls simply are not there. The server
      // refuses the last owner as well, but a screen that offers a tap and then
      // explains why not is a worse screen than one that does not offer it.
      if (isMe) {
        row.appendChild(el('span', { class: 'people-role', text: personLabel(person.role, person.title) }));
      } else {
        const currentKey = choiceKey(person.role, person.title);
        // Named by the email when the person has no name yet: two selects both read
        // out as «Role of (no name yet)» would leave a screen reader guessing.
        const named = [cleanName(person.firstName), cleanName(person.lastName)].filter(Boolean).join(' ');
        const select = roleSelect(currentKey, {
          'aria-label': t('people.roleOf', { name: named || person.email || displayName(person) }),
        });
        select.dataset.uid = person.uid;
        select.addEventListener('keydown', pickFromOpenList);
        select.addEventListener('change', async () => {
          const next = ROLE_CHOICES.find(c => c.key === select.value);
          const applied = next ? await change(person, next) : false;
          // Cancelled or failed: the select must not keep showing a role nobody has.
          if (!applied) select.value = currentKey;
        });
        // The select sits beside the name; Rename and Remove take the line below
        // both, so on a narrow phone (where the select drops under the name) the
        // order still reads name → role → actions.
        row.appendChild(select);
        row.appendChild(el('div', { class: 'people-row-actions' }, [
          el('button', {
            type: 'button', class: 'mgmt-link',
            onClick: () => { renaming = person.uid; paint(); },
          }, t('people.rename')),
          el('button', {
            type: 'button', class: 'mgmt-link danger', onClick: () => remove(person),
          }, t('people.remove')),
        ]));
      }

      list.appendChild(row);
    }

    if (!sorted.length) {
      list.appendChild(el('p', { class: 'people-empty', text: t('people.empty') }));
    }

    if (focusUid) {
      const again = [...list.querySelectorAll('select')].find(x => x.dataset.uid === focusUid);
      if (again) again.focus();
    }
  }

  // ── Giving somebody a name ─────────────────────────────────────────────────
  //
  // ⚠️ EDITED IN THE ROW, NOT IN A POP-UP. The browser's own prompt() is the grey
  // system box this app removed everywhere in PR #28, and confirm-dialog.js only
  // asks yes-or-no — it is byte-identical across six copies and must not grow a
  // text field for one screen. Two inputs in the row need neither.
  //
  // ⚠️ AND IT IS WHAT THE ACCOUNTS MADE IN THE FIREBASE CONSOLE NEED. They never
  // passed through the join screen, so they carry no name at all; without this
  // the roster is a list of email addresses and no way to tell whose phone is
  // whose.
  function renameRow(person) {
    const first = el('input', { class: 'people-input', type: 'text', value: cleanName(person.firstName) });
    first.placeholder = t('people.firstName');
    first.autocomplete = 'given-name';
    const last = el('input', { class: 'people-input', type: 'text', value: cleanName(person.lastName) });
    last.placeholder = t('people.surname');
    last.autocomplete = 'family-name';

    const status = el('p', { class: 'people-note' });
    status.setAttribute('role', 'alert');

    const save = el('button', { type: 'button', class: 'btn-primary people-save' }, t('ui.save'));
    save.addEventListener('click', async () => {
      const problem = nameProblem(first.value, 'first') || nameProblem(last.value, 'last');
      if (problem) {
        status.textContent = problem;
        (nameProblem(first.value, 'first') ? first : last).focus();
        return;
      }
      save.disabled = true;
      try {
        await setMemberName(person.uid, first.value, last.value);
        renaming = null;
        paint();
      } catch (err) {
        save.disabled = false;
        status.textContent = callFailureText(err, t('people.err.name'));
      }
    });

    const cancel = el('button', { type: 'button', class: 'btn-secondary people-save' }, t('people.cancel'));
    cancel.addEventListener('click', () => { renaming = null; paint(); });

    const row = el('div', { class: 'people-member people-member--editing' }, [
      el('span', { class: 'people-email', text: person.email || t('people.noEmailParen') }),
      first, last, status,
      el('div', { class: 'people-row-actions' }, [save, cancel]),
    ]);
    setTimeout(() => first.focus(), 0);
    return row;
  }

  async function change(person, choice) {
    // ⚠️ THE CONFIRMATION SAYS WHAT THE ROLE DOES, not just its name. "Make this
    // person a manager?" means nothing to somebody deciding whether their baker
    // should be one; the sentence about deleting is the whole decision.
    const ok = await confirmDialog({
      title: t(CONFIRM_TITLE[choice.key], { name: displayName(person) }),
      message: t(ROLE_MEANS[choice.key]),
      okLabel: t('people.make', { role: choiceLabelInSentence(choice) }),
      cancelLabel: t('ui.cancel'),
      // Taking power away is the direction that surprises somebody mid-shift.
      danger: choice.role === 'staff',
    });
    if (!ok) return false;
    try { await setMemberRole(person.uid, choice.role, choice.title); }
    catch (err) {
      await alertDialog(callFailureText(err, t('people.err.change')));
      return false;
    }
    return true;
  }

  async function remove(person) {
    const ok = await confirmDialog({
      title: t('people.remove.title'),
      message: t('people.remove.message', {
        name: displayName(person), email: person.email || t('people.noEmail'),
      }),
      okLabel: t('people.remove'), danger: true,
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    try { await setMemberRole(person.uid, null); }
    catch (err) {
      await alertDialog(callFailureText(err, t('people.err.remove')));
    }
  }

  // ── Adding somebody ────────────────────────────────────────────────────────

  function paintCode() {
    codeBox.textContent = '';
    inviteIntro.hidden = !!pending;

    if (!pending) {
      // ⚠️ THE ROLE IS CHOSEN BEFORE THE INVITATION, not after they arrive. Going
      // back to change somebody's role afterwards is a second errand nobody
      // remembers. It starts at Employee — the least power — so a distracted tap
      // grants nothing.
      // ⚠️ ON CHANGE ONLY THE SENTENCE IS REWRITTEN, never the select: rebuilding
      // it would drop the keyboard's focus in the middle of choosing.
      const selectId = 'people-invite-role';
      const roleNote = el('p', { class: 'people-note', text: t(ROLE_MEANS[newChoice.key]) });
      const roleField = roleSelect(newChoice.key, { id: selectId });
      roleField.addEventListener('change', () => {
        newChoice = ROLE_CHOICES.find(c => c.key === roleField.value) || newChoice;
        roleNote.textContent = t(ROLE_MEANS[newChoice.key]);
      });
      codeBox.appendChild(el('label', { class: 'set-label', for: selectId, text: t('people.roleGroup') }));
      codeBox.appendChild(roleField);
      codeBox.appendChild(roleNote);

      // ⚠️⚠️ TWO WAYS TO HAND OVER THE SAME INVITATION, AND NEITHER REPLACES THE
      // OTHER. A link is right when the person is not in front of you, which for
      // somebody who starts on Monday is most of the time — and this is a kitchen,
      // so the channel is WhatsApp, not email (js/join-code.js says in as many
      // words that staff often have no email they read on a phone). Six digits
      // stay right when they ARE in front of you: they need no phone number, no
      // chat, and they leave nothing behind in one.
      //
      // ⚠️ THE ROLE IS DELIBERATELY NOT ON EITHER BUTTON. English needs an article
      // where Italian takes none ("an employee" / «dipendente»), so a role dropped
      // into a button label is a hole no translator can fill well. It is stated
      // twice instead, in whole sentences: by the note directly above, and by the
      // result screen the owner reads before sending anything.
      // The two buttons sit side by side and fall one under the other by
      // themselves when the screen is too narrow (.people-add-row).
      const byLink = el('button', { type: 'button', class: 'btn-primary people-add' },
        t('people.add.link'));
      byLink.addEventListener('click', () => mint('link'));

      const byDigits = el('button', { type: 'button', class: 'btn-secondary people-add' },
        t('people.add.digits'));
      byDigits.addEventListener('click', () => mint('digits'));

      codeBox.appendChild(el('div', { class: 'people-add-row' }, [byLink, byDigits]));
      return;
    }

    if (pending.kind === 'link') paintLink();
    else paintDigits();

    // ⚠️ NO WARNING ON THE WAY OUT, and that is a decision rather than an
    // omission. "New customer" does warn, because only a sha256 of that link is
    // stored and walking away strands a whole business nobody can enter. Here,
    // losing an invitation costs two taps to mint another — so a warning would
    // never mean anything, and a warning that never means anything teaches people
    // to tap through the one that does (the v275 lesson).
  }

  // ── Six digits, read out ───────────────────────────────────────────────────
  //
  // ⚠️ SHOWN ONCE AND NEVER STORED. The server keeps only a hash, so this screen
  // is the only place the code exists in readable form — which is why it is large,
  // and why the sentence under it says what happens next rather than leaving
  // somebody holding six digits and no instructions.
  function paintDigits() {
    codeBox.appendChild(el('p', { class: 'people-hint', text: t('people.readOut') }));
    codeBox.appendChild(el('p', { class: 'people-digits', text: pending.code }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      t('people.joinsAs', {
        role: personLabelInSentence(pending.role, pending.title),
        expires: expiresInWords(pending),
        // ⚠️ THE BUTTON NAMES ITSELF RATHER THAN BEING QUOTED. This sentence used
        // to say: tap “I have a code”. The button has always said "I have a JOIN
        // code", so the instruction was wrong in English — and in Italian it
        // quoted the English words at somebody whose screen says «Ho un codice di
        // accesso». Interpolated, it cannot drift again in either language.
        button: t('auth.iHaveACode'),
      }) }));
    codeBox.appendChild(doneButton());
  }

  // ── A link, sent over WhatsApp ─────────────────────────────────────────────

  function paintLink() {
    const link = joinLinkFor(pending.code);

    codeBox.appendChild(el('p', { class: 'people-hint', text: t('people.link.intro') }));
    // ⚠️ THE LINK IS ON SCREEN AS TEXT WHATEVER THE CLIPBOARD DID. A screen that
    // only said "Copied!" would leave nothing at all behind on the phones where
    // the clipboard silently refuses — and this one cannot be shown again.
    codeBox.appendChild(el('p', { class: 'nc-link', text: link }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      t('people.link.joinsAs', {
        role: personLabelInSentence(pending.role, pending.title),
        expires: expiresInWords(pending),
      }) }));

    // Sending first, because it is the errand: this exists so an owner can add
    // somebody without them being in the room.
    // ⚠️ ONE ARROW, AND THE CHOICE BEHIND IT (24 Aug 2026). It said «Send on WhatsApp»
    // and went straight there with no recipient — so the destination was already
    // «whoever you pick», and asking adds a road rather than changing the errand.
    const wa = el('button', { type: 'button', class: 'btn-primary people-add' },
      [svgElement(SEND_PATHS, 18), el('span', {}, t('ui.send'))]);
    wa.addEventListener('click', () => {
      // ⚠️ THE MESSAGE NAMES THE VENUE. "Open this link" and nothing else is what
      // every scam sent over WhatsApp looks like; the person has to be able to
      // tell, before tapping, that this is the place they work.
      chooseHowToSend({ subject: venueName,
        text: t('people.link.message', { venue: venueName, link }) });
    });
    codeBox.appendChild(wa);

    const copy = el('button', { type: 'button', class: 'btn-secondary people-add' },
      t('help.copyTheLink'));
    copy.addEventListener('click', async () => {
      const copied = await copyToClipboard(link);
      await alertDialog(copied ? t('people.link.copied') : t('people.link.manual', { link }));
    });
    codeBox.appendChild(copy);

    codeBox.appendChild(doneButton());
  }

  function doneButton() {
    const done = el('button', { type: 'button', class: 'btn-secondary people-add' }, t('people.done'));
    // ⚠️ AND THE NEXT INVITATION STARTS ON EMPLOYEE AGAIN. Kept from the last one, a
    // co-owner invited first made the kitchen porter invited next an owner too.
    done.addEventListener('click', () => {
      pending = null;
      newChoice = ROLE_CHOICES.find(c => c.key === 'staff');
      paintCode();
    });
    return done;
  }

  async function mint(kind) {
    try {
      // ⚠️ THE ROLE AND THE SHAPE BOTH COME BACK FROM THE SERVER, AND THAT IS
      // WHAT IS SHOWN. The function reduces a role it does not recognise to an
      // employee and anything that is not the word 'link' to digits — so echoing
      // what was ASKED for could promise a manager where an employee was made, or
      // draw a link screen for six digits. Ask, then show the answer.
      pending = await createJoinCode(newChoice.role, newChoice.title, kind);
      paintCode();
    } catch (err) {
      await alertDialog(callFailureText(err, t('people.err.code')));
    }
  }

  paintCode();
  paint();
  document.body.appendChild(overlay);

  watchMembers(next => { members = next; paint(); })
    .then(unsub => { stop = unsub; })
    .catch(err => {
      console.error('Could not watch the roster:', err);
      members = null;
      paint();
    });

  return { close };
}
