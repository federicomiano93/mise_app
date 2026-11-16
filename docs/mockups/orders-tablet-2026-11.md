# Orders on the lab tablet — agreed redesign (16 Nov 2026)

Federico opened Mise 2's Orders on the lab tablet (SM-T550, Chrome 101, 1024×744 full screen) and found
too many elements. We redesigned it together, step by step, on a live mockup on the tablet:
[`orders-tablet-2026-11.html`](orders-tablet-2026-11.html) (fake names; open at 1024 wide). This file is
the written spec; where the two disagree, this file wins. The phone layout was NOT drawn: he left it to
us («decidi tu»), he sees it in the PR.

**Rule for every new text in this work (his words: «in the lab there is no time to read»):** short.
No explanation lines under buttons or titles; a question is a few words.

Two pieces, each its own branch and PR from `main`: **A** = items 1–6 and the phone; **B** = item 7.

## Whole app
1. **The top bar (venue · date · Online) only on Home.** Everywhere else it is gone. Off Home, when the
   device is offline, a thin amber strip «Offline: salvo qui e invio appena torna la rete» appears under
   the page's title band and goes away by itself. The venue switch stays on Home.
2. **Rail more visible:** 92→104px wide, icons 22→27px with a 2px stroke, labels 12→13.5px weight 500,
   near-white instead of grey (rail background unchanged). Taller items: Settings and the profile must
   still fit at 648px height.

## Orders, split (≥1000px)
3. **Title band:** white (`--surface`), full width, sticky, NO bottom border. «Ordini», then icon buttons
   settings · history · bell (with count) · a «Liste d'ordine» button (icon + text, with the count of
   waiting lists); far right the **Send** icon, which is HIDDEN while a supplier is open (only the
   supplier's own send remains). Gone: the Manda/Ingredienti/Storico word row, the «Ordina oggi» strip,
   the Tutti / Da ordinare filter.
4. **2×2 grid** split by a 1px vertical and a 1px horizontal line (`--line`), across the whole page:
   - **Top left:** tabs Fornitori / Ingredienti + search. Left column narrower: ~300px of content
     (the current `--list-w` is 384).
   - **Top right:** In arrivo / Da riordinare, the SAME size as the Fornitori/Ingredienti tabs, at the
     same height, centred, always visible (also with a supplier open). Under them, centred, only
     «Scegli un fornitore» (bold, no sentence) while no supplier is open. The «N ordini di prima… sono
     arrivati?» banner, when due, sits here too.
   - **Bottom left:** «Salvato ✓», then the suppliers in three groups — **Da ordinare** (due today and not
     yet placed/closed, OR with quantities typed), **Preferiti**, **Altri fornitori**. Each supplier once,
     in the first group it matches; an empty group shows no heading. In a row, «N articoli» moves under
     the name, beside the «Da ordinare oggi» tag. A supplier placed or closed as «non serve» leaves
     «Da ordinare».
   - **Bottom right:** the open supplier, or the bell's notices; empty otherwise.
5. **Open supplier (bottom right):**
   - Header `[X] NAME ›` … `[send]`. Removed: «Cosa vendono», «Riepilogo», «+» (row icons do the first
     two; items are added by going in with ›). X closes and returns to «no supplier chosen»; nothing is
     lost (the draft is saved). Name on one line with an ellipsis.
   - Under it a slim bar «Ordine per [Oggi ▾]» … «Salvato ✓», then ONE 1px line, then column heads
     Articolo · Unità · Ordine · Giacenza, then **each item on ONE row** (~60px): name (weight under,
     small) · unit select · `[−] qty [+]` as one block · stock box. No lines between items or heads.
   - Colours: the whole open card is ONE colour, white; inner controls (X, send, Oggi ▾, unit, the qty
     block, stock box) are light-grey filled with no border; a row with a quantity does not tint the row,
     only its qty block (accent tint, accent-ink number). Measure contrast (≥4.5:1 text; an empty grey
     box must still read as a field).
   - Phone: the item row goes back to two levels (measure at 360 and 296). The left «Salvato ✓» is
     silent while a supplier is open (existing rule).
   - **Send dialog:** title «Invia a»; one-word choices, no explanation lines: **WhatsApp** (pick the
     chat, today's `wa.me/?text=`), **Fornitore** (WhatsApp straight to the supplier). Other routes when
     on, same style: **Email**, **Chi gestisce il locale**.
   - **Message dialog** (after the route): only the supplier name on top («ROSSI», or «ROSSI (1 di 3)»
     for several), the editable message box, Annulla / Invia. Gone: «Cosa riceverà» preview, «Modifica
     il messaggio» label, the «Le modifiche cambiano solo il messaggio…» line. The box keeps an
     invisible accessible name («Messaggio a ROSSI»).
   - **No order photo for now** (his decision): the «Come lo mandi? Foto / Testo» question no longer
     appears; always the WhatsApp text. Keep the photo code, switched off by one constant, easy to turn
     back on.
   - **«Ordine inviato?»**: on coming back to the app after a send, a small centred dialog: the supplier
     name, «Ordine inviato?», big **No / Sì**. No cancel, no tap-outside or Back to close: it must be
     answered. One supplier at a time. Recording logic unchanged (Sì = recorded in history; No = the
     quantities stay). Our choices: it appears on ANY screen; it is forced only on the device that sent
     (on other devices it stays a non-blocking line); answered anywhere, gone everywhere (as today).
     `alertdialog`, focus on the first button, both reachable by keyboard.
   - Coming back to Mise by itself after WhatsApp: NOT done (his decision) — `wa.me` everywhere stays.
6. **The bell's notices** open in the bottom-right pane (replacing the supplier, which comes back when
   they are closed), no longer above the list.

## Phone (<1000px) — our choices
One column as today: the same title band (at 296px «Liste d'ordine» becomes icon + count only), tabs +
search, In arrivo / Da riordinare under the search, then the groups. The supplier full screen with a
Back arrow (not X) and «Riepilogo» kept in its header (the row's summary icon does not exist on a
phone). Notices above the list. Measure at 360 and 296.

## Home (piece B)
7. **Two columns on a tablet:** left «Da fare», right «Ordini da fare» (suppliers due today and not yet
   placed; tap = opens that supplier's order; none left = the card is hidden; only for people who see
   Orders). Phone: one under the other. Reuse `useDueSuppliers` / `dueTodayIds`; mind the reads (P14).

## Do not lose
- «Riapri» for a supplier closed as «non serve»: its door was the strip's chip, now gone → from the
  supplier's row (summary → «Riapri»).
- Focus return (`handBack.ts`): `SEND_OPENER`, `SWAP_OPENER`, `HISTORY_DOOR`, `SETTINGS_OPENER`,
  `INCOMING_DOOR`, `REORDER_DOOR`, `LISTS_DOOR` must point at the new buttons.
- Every icon button: an accessible name, a ≥44px target; contrast ≥4.5:1.
- Chrome 101: no oklch / `:has` / dvh without the fallbacks the guards already pin.
