# Plan: four real sets of books as a regular test

Status: plan agreed 2 November 2026, not built yet. Decisions are at the end.

## The idea

Freeze four sets of books at one date. Each run starts from empty books and
does the import, some reconciling and journals through the screens, and then
checks every report against figures we trust. It is run by script, and a
short report says what passed, what failed and by how much.

| Book | Imported from | Checked against |
|---|---|---|
| Arrow Rock Trading | the Xero full set (`New2/Final Xero Full Set`) | Xero's trial balance and Account Transactions; the 9 filed GST returns |
| Personal and Rentals | bank statements and your spreadsheet's coding | the accountant's FY2026 accounts (rental schedules, IR3); your spreadsheet for FY2027 |
| Xero demo company (AU) | Xero's exports (`New2/XeroDemoAU`) | Xero's trial balance and BAS (scripts already exist) |
| QuickBooks: Craig's Design and Landscaping | QuickBooks' sample company exports (`New2/QuikcBooks Downloads`) | QuickBooks' own trial balance, general ledger and aged reports |

MYOB can be added once there is an MYOB file.

## Freeze a date

Use **30 September 2026**, the end of the last filed GST period, for all of
them. Later work in the real books doesn't change the test. Each test pack is
a folder outside the repo, so nothing private is committed, e.g.
`New2/TestBooks/<book>/`, holding:

- `inputs/`: the files exactly as imported, cut to that date.
- `expected/`: the outside figures (Xero, QuickBooks, the accountant), as JSON.
- `known-differences.json`: each accepted difference with its reason, such as
  depreciation Xero didn't run, import GST claimed late, or the Stripe
  double-count. Without this, a run always "fails" on things we already know
  about, and people stop looking.
- `actions.json`: the screen steps to replay (below).
- `snapshot.json`: every figure from the last good run.

## What a run does, for each book

1. **Empty books** on a local server (one at a time), headless Chrome.
2. **Import** each input through the screens. Check the counts (lines,
   invoices, accounts, contacts) and a time limit; the four-minute freeze on
   Xero's files would have been caught here.
3. **Reconcile through the screens**, from `actions.json`, about 10–20 steps
   that cover the different kinds of work:
   - code a line, with and without a description;
   - split a line (a Stripe payout; a shared expense in Personal);
   - match a receipt to an invoice, and a part-payment;
   - pair a transfer between two accounts;
   - a manual journal (with GST and without);
   - Keep mine and Use Xero on Coding reconciliation;
   - an Undo in History, checking the line is back exactly as it was.
4. **Finish the rest quickly**: the remaining lines take the imported coding
   (Use Xero for all), or for Personal the coding from your spreadsheet. Doing
   all 1,700 lines by clicking would take too long and test nothing new.
5. **Read the reports**: trial balance for each year, P&L, balance sheet, GST
   or BAS per period, the rental schedules and IR3 for Personal.
6. **Compare twice**:
   - against `expected/`, allowing only what is in `known-differences.json`;
   - against `snapshot.json`, which catches *any* change, even to figures no
     outside system has.
7. **Write a report**: one line per book (pass, or N differences), then each
   difference as account, period, expected, got, and which check it failed.

When a figure is meant to change, the snapshot is updated by a command
(`--accept`), so it is always a deliberate step.

## Personal and Rentals: lines written from the backup

Its lines came from bank feeds, not files. The test writes the lines from
the settled backup of 2 November 2026 out as statement files, one per
account, cut at 30 September 2026, and imports those. Its coding comes from
your spreadsheet through Coding reconciliation, which is how the books were
checked anyway.

The spreadsheet has 19 lines that are not in the books, and the test lists
them as known differences:
- 9 are on Arrow Rock's card or account, and belong in Arrow Rock's books.
- 1 is the $19,000 into Simplicity, the other side of a transfer.
- 8 are card purchases the spreadsheet lists twice, about three days apart
  (the bank has each once).
- 1, $141.51 on 2 April 2025 (Jaehee), is not in the bank feed at all. It
  was probably a purchase on 31 March that posted on 2 April, before the
  books start.

## QuickBooks

Craig's Design and Landscaping is QuickBooks' own US sample company, so
there are no US sales tax returns to check against. The test checks the
trial balance, general ledger and aged receivables and payables. QuickBooks
moves the sample company's dates forward over time, so its files are used as
downloaded, not cut at 30 September.

## How it runs

- Only when needed for now: before a change to import, posting, GST or
  reports. Nightly can come later.
- One command: `node New2/TestBooks/run.mjs` for all the books, or
  `... arrow-rock` for one. About 3–5 minutes a book.
- It can't run in GitHub, because the data is private.
- **Any tool can run it, not only Claude.** It's plain Node and Python, with
  nothing that needs Claude's own tools. It starts its own server and
  headless Chrome, and ends with a pass or fail and a report file
  (`New2/TestBooks/report.md`, plus `report.json` for a program to read).
  A `README.md` beside it says how to run it and how to read a failure, so
  Antigravity or another agent can run it and say what broke.
- It builds on the scripts already in `New2/XeroDemoAU/test`
  (`xa-lib.mjs`, `compare.py`, `tb-range.mjs`, `load-filed.mjs`). Those become
  shared, and each book gets a small settings file.

## Order to build

1. Make the existing Xero AU and Arrow Rock scripts into the shared runner,
   with expected, known differences and snapshot. Half a day.
2. Add the screen steps (`actions.json`) for Arrow Rock. Half a day.
3. Personal and Rentals: statements, spreadsheet coding, accountant's
   figures. Half a day, once the statements are downloaded.
4. QuickBooks' Craig's Design and Landscaping.
5. MYOB, once there's a file; nightly runs, if wanted.

## Decisions (2 November 2026)

1. Freeze at 30 September 2026: **yes**.
2. Personal and Rentals: **lines written from the backup**.
3. **Only when needed** for now, written so that other tools (Antigravity)
   can run it too.
4. The fourth book is **QuickBooks** (Craig's Design and Landscaping); MYOB later.

This replaces stage 6 of `docs/testing-strategy.md` and fits beside its
demo-book snapshots, which use invented books and can run in GitHub.
