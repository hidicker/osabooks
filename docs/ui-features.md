# OsaBooks: every screen, for testing

Every page, report and module in the web app, taken from the app itself
(`apps/web/public/index.html`, `apps/web/src/modules.ts`,
`apps/web/src/daily/country-reports.ts`) on 7 November 2026. A tester can
work down it as a checklist.

## Where to test

| Address | What it is |
| --- | --- |
| https://nbparagliding.nz/osabooks_demo/ | The demo. **Demo books** at the top switches between nine invented sets of books (below); **Start the demo again** resets them. Tutorials are here. |
| https://nbparagliding.nz/osabooks/ | The app itself. Without signing in, books are kept in the browser and start as New Zealand demo books. Setup, **Start again empty**, makes them empty books in any of the four countries. |
| https://nbparagliding.nz/osabooks/home/ | The home page, with two interactive examples. |

Books are kept in the browser's storage, so a private window starts clean.

### The nine demo books

| Demo books | Country | Good for |
| --- | --- | --- |
| A coffee roastery with two rentals (the default) | New Zealand | Several entities (a company and two rentals), invoices, GST, IR10, rentals |
| A bakery with three staff | New Zealand | Payroll, PAYE, KiwiSaver, payslips, Payday filing |
| A sailing club (incorporated society) | New Zealand | Non-profit: grants, donation receipts, annual report, IR9 |
| A family trust | New Zealand | Trust people, beneficiaries, IR6 |
| A person with a rental flat | New Zealand | Personal year end, IR3, rental schedules |
| A plumbing company with staff | Australia | BAS, PAYG, super, Australian payroll |
| A photographer with a rental | Australia | Sole trader, rental property schedule, income tax estimate |
| A landscaping company with staff | United States | Schedule C, 1099-NEC, Form 941, sales tax |
| A US freelancer with a rental | United States | Schedule C and E, self-employment tax |

South Korea has no demo books: start empty Korean books from Setup.

## Modules

Most pages appear only when their module is on. **Modules** (under Set up)
turns each on or off; many turn on by themselves once the books hold
something for them. A module for one country's forms is off in the others.

| Module | Countries | Pages it adds |
| --- | --- | --- |
| Customers & vendors | all | Customers & vendors |
| Products & stock | all | Products & services, stock counts |
| Time | all | Time |
| Classes | all | Classes, P&L by class |
| Jobs | all | Jobs, P&L by job |
| Currencies | all | Currencies |
| Budgets | all | Budgets, Budget vs actual |
| Registers | all | Register (cash, petty cash, accounts with no feed) |
| Statement reconciliation | all | Reconcile a statement |
| Business | all | Invoices, Bills, aged reports |
| Company | all | Shareholder current accounts (NZ), IR4 (NZ) |
| Fixed assets | all | Fixed assets, Depreciation schedule |
| GST | New Zealand | GST reconciliation, GST return |
| Rentals | New Zealand | Rental information, Rental year end, Rental schedules |
| Personal | New Zealand | Personal year end, IR3 |
| Partnerships and look-through companies | New Zealand | IR7 |
| Trusts and estates | New Zealand | Trust people, IR6 |
| Non-profit | New Zealand | Grants, Donation receipts, Which report?, Annual report, IR9 |
| Payroll | New Zealand | Payroll (PAYE, KiwiSaver, student loan, payslips, Payday filing) |
| Payroll | Australia | Payroll (PAYG, super, STP figures) |
| Company vehicle | New Zealand | Vehicle private use, in Year-end adjustments |
| Xero import and check | all | Coding reconciliation, from Xero's files |
| Spreadsheet, QuickBooks, MYOB or GnuCash import | all | Coding reconciliation, from those files |

## Pages, menu by menu

Each page has a short hint under its title saying what it does.

### Today
- [ ] **Reconcile**: confirm (✓), change the account, GST treatment, Split
  (Add part, Halve, Put the rest in a part, NZ's Entertainment: half
  deductible), match to an invoice, Entity, account chips, filters, search,
  Accept all, details drawer, Undo.
- [ ] **Actions required**: the cards, Snooze, year-end bank balances.
- [ ] **Register**: New register, entries in and out, Split, Change, Delete,
  running balance.
- [ ] **Bank import**: drop a bank file, duplicates (Keep both / Remove this
  one), statement balance check.
- [ ] **Reconcile a statement**: opening and closing balance, Tick all,
  Difference, Finish this statement, Undo.

### Sales
- [ ] **Invoices**: New invoice, New sales receipt, Quick entry, quotes,
  repeating invoices, saved messages, Load invoices, document (print/PDF),
  email, currencies, Matched / Owing.
- [ ] **Customers & vendors**: contacts, default coding, statements to overdue
  customers, write off small balances, email wording.
- [ ] **Products & services**: products, stocked items, reorder point, Count
  stock.
- [ ] **Time**: add time, Make invoice.

### Purchases & payroll
- [ ] **Bills**: New bill, Approve, Save as draft, Quick entry, the entity, bank
  payment file.
- [ ] **Payroll** (New Zealand): employees, IR330 tax codes, KiwiSaver, New pay
  run, payslips, Payday filing file, bank file, leave.
- [ ] **Payroll** (Australia): employees, TFN declaration, super fund, New pay
  run, PAYG and super, STP year figures.

### Non-profit (New Zealand)
- [ ] **Grants**: add a grant, conditions, Link bank lines, Funder's report, Post
  the entry at year end.
- [ ] **Donation receipts**: Find money received, cash gifts, issue a receipt,
  the signing rules.
- [ ] **Which report?**: small society, Tier 4, Tier 3.
- [ ] **Annual report**: the Tier 4 performance report, print.
- [ ] **Tax return (IR9)**.

### Trusts (New Zealand)
- [ ] **Trust people**: beneficiaries, settlors, appointors, minors.
- [ ] **Tax return (IR6)**: 33% / 39%, minor beneficiaries, Post the allocation
  journal.

### Rentals (New Zealand)
- [ ] **Rental information**: tenancies, rent changes, bond, behind or ahead,
  property care, trips in your own vehicle (with a year choice).
- [ ] **Rental year end**: the schedule per property, property manager
  statements (Enter a statement, Read a statement with AI), vehicles and
  trips, ring-fencing.

### Tax (New Zealand)
- [ ] **GST reconciliation**: periods, Mark as filed, Record a filed return,
  differences and explanations, the lock offer.
- [ ] **Tax return (IR4)**, **(IR7)**: company and partnership returns.
- [ ] **IRD records**: myIR files beside the books.

### Accounting
- [ ] **Fixed assets**: Add asset, edit, dispose, remove, Load a register,
  Download template, Export register.
- [ ] **Manual journals** (a report, below): Write a journal, Adjusting entry,
  GST on a line.
- [ ] **Budgets**, **Classes**, **Jobs**, **Currencies** (rates, Fetch daily
  rates, the two gains accounts).
- [ ] **Personal year end**: salary not in the books, myIR summary of income,
  provisional tax, IR3 questions.

### Reports
Choose the report, the year, the basis (Accrual from our postings, Accrual
from an imported file, Cash), GST in or out, compare columns, and the entity
at the top. Click an account to see its lines. Download as CSV or Excel.

- [ ] Profit and loss
- [ ] Balance sheet
- [ ] Cash flow statement
- [ ] Depreciation schedule
- [ ] Journal report and trial balance
- [ ] General ledger detail
- [ ] Manual journals
- [ ] Bank reconciliation
- [ ] Account transactions
- [ ] Aged payables, Aged receivables
- [ ] Income by customer, Sales by product or service
- [ ] Money between entities
- [ ] Charts
- [ ] Budget vs actual, P&L by class, P&L by job (with their modules)
- New Zealand:
  - [ ] GST return
  - [ ] IR10 financial statement
  - [ ] Shareholder current accounts
  - [ ] Rental schedules
  - [ ] Year-end adjustments (vehicle private use, prepayments)
  - [ ] IR3 individual return
  - [ ] Income by owner
- Australia:
  - [ ] Business activity statement (BAS)
  - [ ] Rental property schedule
  - [ ] Income tax estimate
- United States:
  - [ ] Schedule C
  - [ ] Schedule E
  - [ ] Contractors and 1099-NEC
  - [ ] Self-employment and estimated tax
  - [ ] Sales tax collected and paid
  - [ ] Payroll tax worksheet (Form 941)
- South Korea:
  - [ ] 표준손익계산서 Business income statement
  - [ ] 부동산임대 Rental income
  - [ ] 부가가치세 VAT return
  - [ ] 종합소득세 Income tax estimate

### Set up
- [ ] **Start here**: the guided start (country, where the books come from,
  entities, modules, AI).
- [ ] **Modules**.
- [ ] **Setup**: country, start again empty, source system, files, last
  year's return.
- [ ] **Opening balances**: edit, balance check, Enter bank balances.
- [ ] **Coding reconciliation**: another system's coding beside OsaBooks',
  Keep mine, make rules.
- [ ] **Entities & accounts**: entities and their settings (kind, structure,
  owners and shares by date, shareholders, GST, loans, non-profit and trust
  settings), the chart, Standard accounts, Move lines, Make sub-account,
  Invoice details.
- [ ] **Rules**: add, priority, bank account, export and import.

### AI
- [ ] **AI suggestions**: turn on, own key or shared, copy prompts.
- [ ] **AI connector**: the connector's name and settings for Claude and
  others.
- [ ] **AI accounts check**: the year-end prompt, for each country.

### Books
- [ ] **History and Undo**: every change, filter, Undo, Save a copy.
- [ ] **Books** (top of the page): backup and restore, clear, online books,
  your own Supabase project.

### Everywhere
- [ ] Search (Ctrl+K), light and dark theme, phone width (375px), keyboard
  only, the entity picker at the top, tutorials (demo).

## Not testable from the website

These need OsaBooks running on a computer, a sign-in, or a real account, so a
web-only tester should skip them:
- bank feeds (Akahu, SimpleFIN, Wise) and the nightly fetch;
- online books: signing in, inviting an accountant, shared books;
- the AI connector itself, and AI with a key;
- sending email.
