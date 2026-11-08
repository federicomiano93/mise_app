# The switch: Mise 2 replaces the current app — runbook

## In breve, per Federico

**Cosa succede.** All'ora che scegli tu, a locale chiuso, Mise 2 prende il posto dell'app di oggi allo **stesso
indirizzo** (`federicomiano93.github.io/mise_app/`). Nessuno reinstalla niente: ogni telefono e tablet riceve Mise 2
come riceve ogni aggiornamento, con il solito avviso «aggiorna». I dati restano dove sono (stesso database, stesso
accesso: nessuno deve rientrare). Il link degli ordini dei clienti (`order.html`) resta quello di oggi.

**Prima dell'ora (tocca a te):**
- Prova Mise 2 sul link di anteprima della PR #491, sul telefono e sul tablet del laboratorio (dati di prova).
  Sul tablet guarda soprattutto che lo schermo stia tutto in altezza (punto 44 della lista).
- Su ogni computer del negozio che stampa con la Zebra: aggiorna l'agente di stampa alla versione 1.1.0 e riavvialo.
  Se nessun negozio stampa con la Zebra, dimmelo e lo segno.
- Avvisa The Italian Club che i promemoria degli ordini smettono di arrivare (tornano più avanti).
- Scegli l'ora. Servono circa 45 minuti, con me nella tua sessione.

**All'ora (in ordine):**
1. Io pubblico le nuove regole del database e controllo che quelle online siano identiche. Ti chiedo un clic.
2. Tu, su GitHub → Settings → Pages → «Build and deployment» → Source: scegli **GitHub Actions** (un clic, ti
   guido io). È l'unica impostazione da cambiare.
3. Io faccio il merge della PR #491 (un altro clic) e controllo che il sito online sia Mise 2.
4. Io accendo la pulizia automatica dei promemoria scaduti (il comando che hai già approvato).
5. Tu entri, fai **un salvataggio vero** e mi dici se qualcosa non si salva. Poi riscrivi **50** nel «Peso di un
   pezzo» di «Uova in vassoi» (oggi c'è un valore in chili che Mise 2 legge come 50000 g).

**Se qualcosa va storto:** mi dici «torna indietro». Io preparo la PR che rimette l'app di oggi, tu rimetti
Settings → Pages → Source su **Deploy from a branch** (`main`, cartella `/ (root)`), io faccio il merge. Ogni
telefono torna da solo all'app di oggi alla prima apertura, appena nessuno sta scrivendo. I dati non si toccano. Le
regole del database restano quelle nuove (vanno bene anche per l'app di oggi).

---

## Before the hour

Everything in «Switch checklist» of `docs/mise2-port-owed.md` ticked: the release PR's `test` job runs with
`MISE2_SWITCH=1` and stays red until it is (that is what the check is for). Specifically, from him:
- [ ] He tried #491's preview on his phone and the lab tablet (SM-T550, Chrome 101), item 44 included.
- [ ] Zebra print agent 1.1.0 pulled and restarted on every shop computer that prints through the Zebra queue
      (`js/catalogue/label-zpl.js` on the release branch adds `^PON` to every standard label; agent 1.0.1 refuses it).
- [ ] The Italian Club warned that order reminders stop (reminder notifications are deferred until after the switch).
- [ ] The hour picked, the venue closed.

And from the session that runs it (go-live «Before asking him», with these differences):
- `gh pr checks 491` → `test` (with `MISE2_SWITCH=1`), `rules`, `mise2`, `pages-site` green; `preview` green and its link opened once.
- `cd functions && npm audit --audit-level=high` clean (deploy-functions runs on the merge's push).
- `git fetch && node scripts/rules-live-diff.mjs origin/main` → `identical: true` (the live rules are main's).
- The release branch contains the latest `main`: `git merge-base --is-ancestor origin/main origin/feature/mise2-release`.
  If not, merge main into it first (its own PR), and rebuild nothing by hand: Mise 2's `sw.js` is built by CI.

## At the hour, in this order

1. **Rules first, with read-back.** Mise 2 writes keys the live rules (main's) refuse, and the release rules still
   accept everything the current app writes (`rules` runs the current app's suite against them on the release branch).
   ```bash
   git fetch origin && git switch feature/mise2-release && git pull --ff-only
   firebase deploy --only firestore:rules --project bakery-app-ebf90
   node scripts/rules-live-diff.mjs
   ```
   Three warnings are normal (`member()`, `cardAccess()`, `orderClientOf()`); a fourth → stop and read it. The diff
   must say `identical: true`.
2. **His click: Pages source → «GitHub Actions»** (Settings → Pages → Build and deployment → Source). Today Pages
   publishes the committed files of `main` (Source: «Deploy from a branch»). From the merge on it publishes the site
   `.github/workflows/pages.yml` builds: Mise 2 at the root plus the current app's pages that must keep working. The
   site already published stays up until the next deployment, which the merge makes. Do it right before step 3.
3. **Merge**: `gh pr merge 491 --merge` (a merge commit; never squash). Never `git push origin main`.
4. **Watch main**: `gh run list --branch main --limit 5` → `test`, `rules`, `mise2`, `deploy-functions` and the
   `Pages` workflow (`build-site`, `deploy`) all `success`. If no run appears in ~5 minutes, say so.
5. **Verify live**:
   ```bash
   node scripts/verify-live-site.mjs
   ```
   It asks the live site for Mise 2's `sw.js` and every file of the page, the current app's `order.html` and
   `reset-password.html` with every file they load, the stub pages and the manifest, and says what does not answer.
   Then open `https://federicomiano93.github.io/mise_app/` at phone width: Mise 2's sign-in screen, no console error.
   Signing in on production is his (no test account exists there).
6. **The TTL policy** on the Home to-dos (his OK given for the switch):
   ```bash
   gcloud firestore fields ttls update expireAt --collection-group=todos --enable-ttl --project bakery-app-ebf90
   ```
7. **His checks**: one real save on a screen he uses, and the one-off retype: «Uova in vassoi» (Miano) → «Peso di
   un pezzo» → **50** (it holds 50 kg from before the piece weight was typed in grams; Mise 2 shows 50000 g).
8. **Tag, Release, records** as in go-live 4–5. Proposed: `v2.0.0` (a major: the whole app is new), annotation free of
   business data.

## What each device does at the switch

- **An installed phone or tablet of the current app** checks `sw.js` when it opens, when it comes back to the front
  and every 15 minutes (`js/sw-update.js`). It finds Mise 2's worker at the same address, installs it in the
  background (about 1.4 MB, once), and shows the current app's own update banner, then its compulsory update window,
  which waits while somebody is typing. The tap sends `{action: 'skipWaiting'}`, which Mise 2's worker honours: it
  takes over, removes the current app's caches (never IndexedDB or localStorage), and the page reloads as Mise 2.
  Proved in a real Chromium by `node app/sw/drive-switch.cjs`, and in node:vm by `app/src/shell/rollback.spec.ts`.
- **Who is signed in** stays signed in: the same Firebase Auth record, the same IndexedDB, the same SDK version.
  Writes made offline and not sent yet stay in Firestore's queue and leave with Mise 2.
- **An old address** (`orders.html`, `calculator.html`, a bookmark, a notification) opens its Mise 2 screen: the worker
  answers it, and without the worker the site's stub page does (`app/sw/legacy-routes.json`).
- **A client's ordering link** (`order.html?…`) is the current app's page, unchanged, with every file it loads.
- **The password-reset email** opens `reset-password.html`, unchanged; never cached.
- **Notifications** already subscribed by the current app may still arrive (the subscription belongs to the
  registration, which is kept): they show the server's text and open the right Mise 2 screen. Mise 2 subscribes nobody
  new until reminder notifications are ported.
- **A new device** gets Mise 2 directly.

## Rollback — if it is broken and cannot be fixed in minutes

**First check it is allowed** (go-live, «roll back, do not patch forward»): if anything saved since the switch raised a
model number the rules refuse to lower, or a key became required on a whole-document write, do NOT roll back: patch
forward. The Mise 2 release itself raises none (the rules accept both apps' writes), but read the release's
`firestore.rules` diff again if a fix was added after this was written.

1. On a branch, the revert, keeping the live rules, and the current app's `sw.js` one release higher:
   ```bash
   git switch main && git pull --ff-only
   git switch -c fix/revert-mise2-switch
   git revert -m 1 <merge-sha-of-491>
   git checkout <merge-sha-of-491> -- firestore.rules
   node scripts/sw-hashes.mjs --bump
   git commit -am "revert: back to the current app (Mise 2 switch reverted)"
   git push -u origin fix/revert-mise2-switch
   ```
   - ⚠️ **Keep the live rules** (`git checkout … -- firestore.rules`): main must keep saying what is live, and an older
     rules file must never be deployed (phones have saved the new keys). The current app works under them.
   - ⚠️ **`--bump` is required**: the revert restores files identical to the last release, so nothing else would give
     the current app's `sw.js` a new `CACHE_NAME` (`tests/sw-hashes-bump.test.mjs`).
2. PR into `main` → `test`, `rules`, `mise2` green (the revert's `test` runs without the switch check: the release's
   workflow change is reverted too).
3. **His click: Pages source back to «Deploy from a branch»**, branch `main`, folder `/ (root)`. The revert removes
   `.github/workflows/pages.yml` with the rest of the release, so nothing would publish the site otherwise; from the
   branch, Pages publishes main's committed files, as before the switch.
4. **Merge** the revert PR (`--merge`), watch main, then `node scripts/verify-live-assets.mjs` (the current app's own
   check) → `sameRelease: true`, `problems: []`. If the site still shows Mise 2 after a few minutes, kick a build:
   `gh api -X POST repos/federicomiano93/mise_app/pages/builds`.

**What each device does then.** Mise 2's page checks `sw.js` when it opens, comes back to the front and every 15
minutes (`app/src/shell/serviceWorker.ts`). It finds the current app's worker, one release higher, which installs and
waits; Mise 2 lets ANY waiting worker in as soon as nobody is editing (`markBusy()`), so the current app's worker
takes over, removes Mise 2's cache, and the page reloads as the current app. A device offline does it at its next
connection; a tablet left on an editor does it once that editor is saved or left. Who is signed in, the offline copy
and unsent writes are untouched in both directions. Proved by `app/src/shell/rollback.spec.ts` (node:vm, the real
`sw.js`) and `node app/sw/drive-switch.cjs` (real Chromium).

## What this runbook cannot do by itself

- Deploying the rules, merging #491 and running the TTL command need his explicit word in his own session.
- The Pages source setting is his click, both at the switch and at a rollback (GitHub Settings → Pages).
- Nothing here was run against production: it was rehearsed in node:vm, in a local Chromium and on the preview
  project (`mise-app-preview`, fake data).
