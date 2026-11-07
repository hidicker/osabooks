# Backlog

Things found and not yet fixed, because the fix is not obvious or not small.
Newest at the top of each section. When one is done, take it off and say so in
the commit. The larger, planned work is in [roadmap.md](roadmap.md).

## Waiting on a decision

- **Partnering with OpenAccountants.** Michael (OpenAccountants) suggested
  working together: OsaBooks showing their guides in use, and a business in
  installing and maintaining OsaBooks with the guides rather than a
  subscription. Asked him (3 November 2026) what it would look like, who would
  deliver installs (a first few done by the owner as a pilot), and whether his
  accountants would try it on a few clients' books. Until then: the pull
  request adding OsaBooks to their README's Related open-source projects (one
  line, CLA box to tick by hand) and the update to their Slack are held.
- **One connector for all of a person's books.** Today each set of books has
  its own connector address. One address with a "list my books" tool, each
  other tool taking which books, would mean one sign-in; the per-book
  addresses would stay for giving a tool one set only. Kept per book for now
  (3 November 2026).
- **Rename the local folder `Documents\nzosa` to OsaBooks.** This project's
  Claude Code history and memory, the extension's books folder, the test
  books and DeepSeek's setup all point at the path, and it cannot be done
  from a session running in it. Needs a checklist and a quiet moment.
- **`supabase db push` does not know the live database's history.** The
  migrations were applied in the SQL editor, so the project's migration record
  is empty and `db push` starts again from the first one (it fails at once on
  "books already exists", changing nothing). Until it is fixed, apply a new
  migration in the SQL editor. The fix is `supabase migration repair --status
  applied <version>` for each migration already in place, after checking each
  one really is there.

## Ledger integrity

Settings that change entries already confirmed, in past years, without
saying so. Each is set out in [ledger-integrity.md](ledger-integrity.md), with
whether lock dates catch it today. The principle to follow: a setting applies
from when it is changed, and reaching what is already confirmed is a separate,
deliberate step that says what it will change (as money between entities now
works).

- **Lock dates enforced on the server, not only the lock dates themselves.**
  Since 20261012120000_deleted_books_and_locks.sql, save_part refuses a
  bookkeeper's save that moves the lock dates. What they lock is still guarded
  by the page alone: a save that changes a coding, journal or invoice dated on
  or before a lock is not refused by the server. Doing it there means
  comparing the locked figures (`lockedFigures` in core's lock-dates.ts) in the
  database, or in an edge function every save goes through.
## Tax and returns

- **A shared bank account is held under the GST lock even for an unregistered
  entity's line.** A line on an account that pays for a GST-registered entity
  and an unregistered one cannot be told apart until it is coded, so it is held
  back. Coding it first, then deciding, would be more precise.
- **Provisional tax by the ratio option (GST103): a fixed asset sale is not
  taken out first.** A fixed asset sold for at least $1,000 or 5% of the last
  12 months' taxable supplies, whichever is larger, comes out of the supplies
  the ratio is applied to. The GST return says it is not done. Added 7
  November 2026; the rule is from the OpenAccountants guide, not yet checked
  by an accountant.
- **Two New Zealand GST invoice-basis rules not applied** (from the
  OpenAccountants NZ GST guide, checked 16 October 2026): a single supply over
  $225,000 must go on the invoice basis whatever basis is chosen (unless
  settled within 365 days), and on the invoice basis a payment received
  before the invoice is issued makes the GST due when paid. Both rare for the
  businesses OsaBooks is for; the GST return takes neither into account yet.

## QuickBooks and the United States

- **QuickBooks invoices, bills and customers as documents.** The general ledger
  brings in every invoice and bill as a journal, so the profit and loss and
  balance sheet match, but they are journals, not invoices: no due dates, no
  customer list, no aged receivables or payables, and a customer payment is
  coded to receivables rather than matched to an invoice. QuickBooks' own
  exports (A/R and A/P aging detail, Customer and Vendor lists, Invoice list,
  Trial balance, Product/Service list) hold what is missing.
- **Other expense on the profit and loss.** QuickBooks puts "Other expense"
  below net operating income; here it sits among operating expenses. Net
  profit agrees, the subtotal does not.
- **A credit card sits under assets** (as negative) in the balance sheet, as
  Xero's do, where QuickBooks has it under liabilities. Net assets agree.
- **Sample QuickBooks exports in the US demo**, for the "Moving from
  QuickBooks" lesson to offer.
- **US income tax** stops at the single filer with the standard deduction: no
  QBI deduction, credits, other filing statuses or state tax.
- **Form 940 and W-2**: none yet. The Form 941 worksheet and the sales tax
  report are there.

## Imports from other software

- **MYOB import: what it does not bring yet.** The accounts list and journal
  entries come across (`packages/core/src/myob.ts`): every posting, bank lines
  coded, the rest as journals. MYOB's sales and purchases exports (open
  invoices and bills, with due dates), its cards (customers and suppliers) and
  items are not read, so invoices and bills arrive as journals rather than as
  documents to be paid. The reader follows MYOB's published export layouts;
  no real MYOB file has been tried yet. 26 October 2026.
- **Imports from Sage 50, Wave, Zoho Books and the Transaction Pro bank
  sheet.** GnuCash is read (`packages/core/src/gnucash.ts`:
  the account tree and the transactions CSV, both layouts). The other four
  export formats vary by version and country and none was in hand to build
  against; each needs a real export (with invented figures) to write its
  reader and test it. Like MYOB, no real GnuCash file has been tried yet.
  27 October 2026.
- **Expense claims and manual journals from Account Transactions.** They
  come only from Xero's Journal Report, and a report exported for a month
  leaves the rest out (now named when it happens). The full Account
  Transactions export, which every Xero move loads, holds them too
  ("Expense Claim", "Manual Journal" rows), so the second export could be
  unnecessary. 1 November 2026.
- **Warnings about a file are folded away.** An aged report or journal
  report dated wrongly for the books is said under "What was read", which
  is closed; it should be said where it is seen. 1 November 2026.
- **A single large import file holds the page for up to a second.** Reading,
  matching and posting run on the page's own thread. A full Xero move went from
  minutes to about 4 s busy on 31 October 2026 (one save at the end, pages not
  on screen left alone); moving the reading to a worker would take the rest.

## The app

- **A currency with three decimals is held to two.** Dinars and rials are
  read with their third decimal but held, like every amount, in hundredths:
  12.345 BHD is 12.35. None of the four countries uses one, so only foreign
  amounts are touched. Holding such a currency in thousandths would fix it.
  From DeepSeek's findings of 6 November 2026, 2.
- **No Korean test book.** The Korean pack (won, VAT, income tax, the AI
  check's prompt) is checked by unit tests only; nothing takes Korean books
  through the screens. A public Korean sample file, or invented books, would
  close it.
- **Filed returns to compare with, outside New Zealand.** New Zealand books
  load what was filed from myIR and show each GST period beside it. An
  Australian BAS, a Korean VAT return or a US sales tax return filed
  elsewhere cannot be loaded to compare yet.
- **Tests on every push, and a linter.** The tests run only when a deploy is
  started. A `ci.yml` on push running `npm ci && npm test`, and
  typescript-eslint with no-floating-promises, no-misused-promises and a check
  against `toISOString().slice(0, 10)` outside dates.ts. Not wanted for now
  (3 November 2026): the tests run before each deploy and when asked. DeepSeek review, 7.
- **The developer guide's counts are out of date**: 579 core tests (now about
  1,580), three packages (four), `books.ts` at 727 lines (2,600). Generate
  them, or drop the numbers. DeepSeek review, 8.
- **Smaller hardening, from the same review:** a size limit on the local
  server's JSON bodies; the open-books lock (`heldBy`) judged by process id,
  which a reboot can reuse; and a per-run token for the local API, which any
  program on the computer can call today.
- **US meals: half deductible.** The entertainment button in the split editor
  is New Zealand's rule (half deductible, half the GST claimed) and shows only
  where the country pack says `entertainmentHalf`. The US halves business
  meals for income tax only, with no sales tax; a "Meals: half deductible"
  split for US books would need a non-deductible meals account in the chart.
  Canada, if added, has New Zealand's rule.
- **Very large files.** `books.ts` (2,600 lines and 105 exports, every page imports it), `reports.ts` (about 6,000 lines),
  `coding-reconciliation.ts` (4,500), `excel-export.ts`, `reconcile-page.ts`,
  `store.ts`. The same idea gets built several ways in them (long tables,
  Accept all). See `refactor-plan.md`. Code check 2 November 2026, 12.
- **Wise balances in other currencies.** Only balances in the books' own
  currency can be brought in (`wise-feed.ts`): a KRW or EUR line came in as if
  it were dollars. Bringing others in needs each line converted at the day's
  rate (Wise's statement gives the rate on conversions, not on every line), a
  foreign-currency bank account in the chart, and the realised gain or loss
  on conversion posted. Xero's chart had no row for Wise KRW either, so the
  link step needs a way to add a bank row for one.
- **Reconcile tick, stage 2: redraw only the ticked line.** Stage 1 is done: a
  tick no longer waits for its saves (about 0.3 s on books online, down from
  0.8–2.6 s), and the writes queue in order (`writeQueue` in core). What is
  left is the full redraw of up to 200 rows. Plan: in the plain case only --
  a suggestion accepted, no rule made or changed, no split, invoice, transfer
  or asset -- take the row out and update the counts; anything else redraws
  in full as now. Held until asked for. Not yet tested by hand: cutting the
  connection mid-tick (the "not saved" warning, and the warning on leaving
  with saves outstanding), and two tabs on the same books.
- **Books in a folder still write each changed part whole.** Books online
  now send only what changed (`save_part_changes`, and `part-changes.ts` in
  core), with the coding and its history entry in one request. A folder is
  the app on the same computer, so the size matters far less there, but the
  history file is still rewritten on every change. The same change lists
  could go to `PUT api/ledger/parts/:part` if it ever shows.
- **The rules go whole when a tick makes or changes one.** Changes reach
  two levels into a part, and the list of rules is the third (`rules.rules`),
  so it is sent whole: 7–17 KB on the books online in Oct 2026, against a
  few hundred bytes for the coding. Small, but the biggest piece of such a
  tick. Reaching a third level means `apply_part_ops` taking longer paths.
- **What each online save replaced is all kept.** The owner decided on
  22 Oct 2026 to keep all of it (then about 68 MB of an 87 MB database, from
  the whole copies saves used to keep). Saves now keep the change rather
  than a whole copy, with a whole copy at most once a day per part, so it
  grows slowly. Revisit only if the database nears the free plan's 500 MB:
  `prune_part_history(interval)` removes rows older than the interval and
  keeps each part rebuildable.
- **The lock guard works out every GST return from the first transaction on
  every save.** Measured 24 Oct 2026 on invented books in the browser, eight
  years and 11,800 bank lines: with lock dates set, about 230 ms a save (525
  ms the save that sets them); with none, nothing. Noticeable, not the slow
  part (below). Working out only the periods up to the lock would cut it.
- **Bank payment files for ASB and Kiwibank.** The Bank file button
  (`packages/core/src/payment-files.ts`) writes BNZ, ANZ and Westpac files,
  each checked against the bank's published guide. ASB's guide (MT9, fixed 160
  characters, or CSV) refused to download (403) and Kiwibank publishes none
  that could be found. Add each once its guide is in hand; until then an ASB
  or Kiwibank customer could try the ANZ file,
  but that is untested. 25 October 2026.
- **Undoing a merge of two accounts.** Undoing a rename now renames the account
  back, carrying everything with it. Undoing a merge only puts the merged
  account back in the chart: its codings, rules and documents stay on the
  account it was merged into, because once merged they cannot be told apart.
  A merge would need to record which items it moved to be undone fully.
  26 October 2026.
- **Foreign currencies: what the first version leaves out.**
  (`packages/core/src/fx.ts`, Currencies page.) Documents
  and bank lines in another currency count at their dates' rates, payments
  realise the exchange difference, conversions between own accounts post the
  spread, and foreign bank accounts are revalued at each balance date. Not
  yet: foreign receivables and payables still open at a balance date are not
  revalued (they stay at the document's rate); credit notes and credit used
  across currencies are not converted; quick entry and sales receipts are in
  the books' currency only; with several entities the exchange accounts are
  one pair for all; and Reconcile shows a foreign line in its own currency
  with no converted figure beside it. 27 October 2026.

## Online books

- **The two books lists offer the same things.** Books in a folder (Books
  page, `books-page.ts`) have Open, Make a copy… and Clear…; books online
  (`cloud-books.ts`) have Open, Rename, Delete and Start a new set. Both
  should have Open, Rename, Make a copy…, Clear… and Delete, in the same
  order and words, each where it makes sense:
  - **Copy online:** `createBook` plus each part from `loadParts`, saved with
    `savePart`. Not copied: the bank feed connection (two sets fetching from
    one bank would muddle both), the AI key, sharing, the morning run's part,
    and History, which starts with a note of where the copy came from.
  - **Clear online:** empty the parts but keep the set, its name and its
    sharing, as Clear does for a folder (which keeps a dated copy to put back).
  - **Rename and Delete for a folder:** Delete moves the folder aside rather
    than removing it, like Clear, so it can be put back.
  - **When each was last opened, by the person looking.** Online this needs a
    per-person record (a `last_opened_at` on the membership row, set on
    opening); in a folder, a note beside the books. Shown as a column, and
    the list sorted by it.
- **Own Supabase project: no bank feed, AI or morning run.** These are edge
  functions, and a person's own project does not have them. Deploying them
  there would need the person's own Akahu and AI keys, and a guided set-up.
- **The morning run starts every set of books at once.** Fine for a few dozen;
  with hundreds it should go in batches.
- **SimpleFIN for books kept online.** The SimpleFIN feed works on the
  desktop app only: its Access URL is kept in `.simplefin.json` by the local
  server. Books kept online need it in Supabase Vault with an edge function
  (`supabase/functions/simplefin`, a `simplefin_secret` table and RPCs), as
  `supabase/functions/wise` does for Wise. Left because it changes the
  production database. 18 October 2026.
- **Payment reminders: what the first version leaves out.** They go from the
  OsaBooks mailbox in the business's name, with replies to the business, not
  from the business's own address (that needs each business's domain set up
  to send). Only online books send them by themselves; books in the browser
  or a folder list them to open one by one. At most 50 a morning from one set
  of books. If the record of what was sent fails to save after sending, the
  same reminders go again the next morning. Added 7 November 2026.
- **Card payments with Stripe: what the first version leaves out.**
  (`supabase/functions/stripe`, `apps/web/src/daily/stripe-ui.ts`). Books kept
  online only: books in a folder or the browser have nowhere safe for the key
  (a folder version could keep it beside the ledgers, as Wise's desktop token
  is). Payments are found by asking Stripe when the Invoices page opens, not
  by a webhook, so a payment shows the next time it is opened. A link is for
  the amount owing when it was made; after a part payment a new one is made
  and the old one closed. The money reaches the books with Stripe's payout,
  as before. 27 October 2026.
