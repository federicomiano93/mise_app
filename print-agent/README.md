# Mise print agent

The small program that lets a **phone** print a food label on a printer plugged into
the **shop computer**.

No browser on any phone can reach a printer attached to a different machine. That is
a fact about phones, not a gap in the app. So the phone writes the label into the
database, and this program — running where the printer is — takes it and prints it.

It has **no dependencies**: plain Node, no `npm install`, no `node_modules`. Node 18
or newer.

---

## What you need first

1. **The printer working from this computer.** Print a test page from Windows before
   going anywhere near this program. If Windows cannot print, nothing here will.

2. **A dedicated account for the printer**, created in the app like any other member
   of staff — an **employee**, not a manager or an owner. It can read the venue's
   recipes and print jobs and nothing else, exactly like a phone on the counter.

   ⚠️ Do not use your own account. If you ever change your password the printing
   stops, and nobody will connect the two.

3. **The printer shared**, if it is plugged into this computer by USB:
   - Windows → Settings → Bluetooth & devices → Printers & scanners
   - open the Zebra → Printer properties → **Sharing** → tick *Share this printer*
   - give it a short name with no spaces, e.g. `ZEBRA`
   - the full name is then `\\THIS-PC\ZEBRA` (use this computer's real name)

   ⚠️ **Why sharing, when the printer is right here.** Bytes written to a share go to
   the printer **untouched**. Sent through the normal Windows driver they would be
   *rendered* — you would get a page with `^XA^CI28…` printed on it as text instead
   of a label.

---

## Setting it up

1. Copy `print-agent.example.json` to:

   ```
   %LOCALAPPDATA%\Mise\print-agent.json
   ```

   ⚠️ **Not into this folder.** Everything in this repository is published on the
   web; a password saved here would go with it.

2. Fill in the email, the password, the venue id and the printer share.
   `darkness` (0–30) is optional: when it is there the agent sends it to the printer
   before every label (the «with logo» label was tuned at **28**). A Zebra keeps it until
   it is switched off, so every label printed after it — the standard ones too — comes
   out at that darkness. It can only be set here: the print queue refuses every printer
   setting, because anybody who can print a label could otherwise change the printer.

3. In the app: **Recipes → Settings → Label printing → Printer → Zebra**.
   The agent only receives standard labels from a venue set to Zebra — on any other
   setting the app prints them through the normal print dialog and never queues
   anything. The **«with logo»** label (Mise 2) needs no setting: it is a Zebra label by
   construction, and the app queues it whenever an agent of version **1.1.0** or later
   is answering. It prints turned round and at speed 2; the standard label resets the
   turn (^PON), but the slower speed stays until the printer is switched off — slower,
   never wrong.

4. Run it:

   ```
   node print-agent\agent.mjs
   ```

   It prints what it is connected to and then waits. **Leave the window open.**

---

## Starting it automatically

Task Scheduler → Create Task:

- **General** → *Run whether user is logged on or not* is **not** what you want here;
  a shared printer needs the user session. Use *Run only when user is logged on*.
- **Triggers** → *At log on*
- **Actions** → Start a program
  - Program: `node`
  - Arguments: `print-agent\agent.mjs`
  - Start in: the folder this repository is checked out to
- **Settings** → tick *If the task fails, restart every 1 minute*

---

## How to tell it is working

Open a label in the app on your phone. Above the Print button it says either
**«printer ready»** or **«the shop computer is not answering»** — the agent writes a
heartbeat every four minutes and the app reads it, so you know *before* you tap.

⚠️ **The app can only ever say «sent», never «printed».** Raw bytes to a printer come
back with nothing at all, so nothing in the app knows whether the paper came out. If
the app says it was sent and no label appeared, the problem is between this program
and the printer — check this window, which logs every job and every failure.

---

## When something is wrong

| What you see | What it usually is |
|---|---|
| `Sign-in refused` | wrong email or password in the settings file |
| `could not read the queue (403)` | the account is not a member of that venue, or `locationId` is wrong |
| `copy to \\… failed` | the share name is wrong, or the printer is not shared |
| `did not answer` | (network printer) wrong address, or the printer is asleep |
| Nothing prints, no errors | the venue is not set to **Zebra** in Settings, so nothing is being queued |
| A page of `^XA` codes comes out as text | the bytes went through the driver — print to the **share**, not the printer name |
| The app says the printing program «needs updating» on a «with logo» label | this computer runs an agent older than **1.1.0**, which refuses the label's picture — `git pull` in the repository folder and restart the program |
| `printer.darkness must be a whole number` | the settings file has a darkness that is not 0–30: fix it or take the line out |
| Accented letters print wrong («Può» as `Pu?` or a box) | this computer runs an agent older than **1.0.1** (the first line of this window says which), which sent latin1 to a printer told to read UTF-8 — update the whole checkout (`git pull` in the repository folder, not just `print-agent\`) and restart the program |

---

## What it costs

There is no live listener without the Firebase SDK, so the queue is **polled**: every
15 seconds when idle, every 3 seconds for a minute after it sees work. That is about
**5 800 reads a day** against a free allowance of 50 000. `POLL_IDLE_MS` at the top of
`agent.mjs` is the dial if that ever needs turning down.

## Two of these running at once

Only one of them will print each label. A job is claimed with a condition on the
document's own version, and the security rules refuse a second claim as well — two
locks, because the thing they prevent is the same allergen label going onto two
different products.
