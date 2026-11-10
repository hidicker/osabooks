import { emptyEntityModel, groupProfitAndLoss, isCreditNote, isEstimate, isPosted, localToday } from "@nzosa/core";
import type { Cents, Invoice } from "@nzosa/core";
import { banks, entityBankAccounts, invoiceBalanceMap, invoicesInPlay } from "../books.js";
import { lineChart, monthlyColumns, rankedBars, ringChart } from "../charts.js";
import type { RingSlice } from "../charts.js";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import { amountCell, nameCell, note } from "../ui.js";
import { agedFor, agedTotal } from "./aged-report.js";
import { reportRange } from "./report-period.js";
import { balanceSheetOn, currentReport, monthsOfYear, reportLookups } from "./reports.js";

/**
 * The dashboard: the books at a glance, from the same builders the reports use.
 *
 * Every figure is one the reports already work out -- the profit and loss for
 * the year and for each month, the balance sheet on a day, the aged
 * receivables and payables -- so a figure here can never disagree with the
 * report behind it, and the year, entity and basis chosen on the Reports page
 * apply here too.
 *
 * Worked out only when it is opened, and then kept: the month ends alone are a
 * dozen balance sheets and two dozen aged reports, which is fine on a button
 * press and not something to repeat on every redraw. When the books change
 * after it was worked out, it says so and waits for Refresh rather than
 * working everything out again behind the person's back.
 */

interface Held {
  key: string;
  /** The ledger it was worked out from: a save replaces the object. */
  ledger: unknown;
  at: Date;
  took: number;
  element: HTMLElement;
}

let held: Held | null = null;

/** What the figures depend on, besides the books: the year, entity and basis chosen. */
function settingsKey(year: number): string {
  const basis = document.querySelector<HTMLSelectElement>("#report-basis")?.value ?? "";
  const gst = document.querySelector<HTMLSelectElement>("#report-gst")?.value ?? "";
  const unadjusted = document.querySelector<HTMLInputElement>("#report-unadjusted")?.checked === true;
  return [year, state.entityFilter, basis, gst, unadjusted].join("|");
}

export function renderDashboard(body: HTMLElement, year: number): void {
  const bar = document.createElement("div");
  bar.className = "dashboard-bar";
  const said = document.createElement("span");
  said.className = "dashboard-said";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  bar.append(said, refresh);
  const place = document.createElement("div");
  place.className = "dashboard";
  body.append(bar, place);

  const key = settingsKey(year);
  const work = (): void => {
    refresh.disabled = true;
    said.textContent = "Working out the dashboard…";
    place.textContent = "";
    // After the page has painted, so the button and the words show first.
    setTimeout(() => {
      const started = performance.now();
      let element: HTMLElement;
      try {
        element = build(year);
      } catch (error) {
        element = note(`The dashboard could not be worked out: ${(error as Error).message}`);
      }
      held = { key, ledger: state.ledger, at: new Date(), took: performance.now() - started, element };
      show();
    }, 30);
  };
  const show = (): void => {
    if (held === null) return;
    refresh.disabled = false;
    place.textContent = "";
    place.append(held.element);
    const when = held.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    said.textContent =
      held.ledger === state.ledger
        ? `Worked out at ${when}.`
        : `Worked out at ${when}. The books have changed since: Refresh to bring it up to date.`;
    said.classList.toggle("dashboard-stale", held.ledger !== state.ledger);
  };
  refresh.addEventListener("click", work);

  if (held !== null && held.key === key) show();
  else work();
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

/** The bank accounts in scope: the chosen entity's, or every one. */
function bankIds(): Set<string> {
  const mine = entityBankAccounts();
  return new Set(mine.length > 0 ? mine : banks().accounts);
}

/** Every bank account's balance on a day, as the balance sheet has it. */
function bankOn(date: string): Cents {
  const ids = bankIds();
  const bankCodes = new Set(state.chart.filter((a) => a.type.trim().toLowerCase() === "bank").map((a) => a.code.trim()));
  const sheet = balanceSheetOn(date);
  let total = 0;
  for (const part of [sheet.currentAssets, sheet.currentLiabilities]) {
    for (const line of part.lines) {
      if (ids.has(line.code) || bankCodes.has(line.code.trim())) total += part === sheet.currentAssets ? line.closing : -line.closing;
    }
  }
  return total;
}

/** Money into and out of the bank accounts in scope, leaving out moves between them. */
function cashBetween(from: string, to: string): { received: Cents; spent: Cents } {
  const ids = bankIds();
  const transfers = state.ledger.transfers ?? {};
  let received = 0;
  let spent = 0;
  for (const t of state.ledger.transactions) {
    if (t.date < from || t.date > to || !ids.has(t.account) || transfers[t.id] !== undefined) continue;
    if (t.amount > 0) received += t.amount;
    else spent -= t.amount;
  }
  return { received, spent };
}

/** Whether a document is the chosen entity's, as the aged reports decide it. */
function inScope(invoice: Invoice): boolean {
  if (state.entityFilter === "") return true;
  if (invoice.entityId !== undefined) return invoice.entityId === state.entityFilter;
  const model = state.ledger.entities ?? emptyEntityModel();
  return invoice.lines.some((l) => model.accounts[l.accountCode.trim()] === state.entityFilter);
}

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A month's profit and loss, cash, invoices and position, for the comparison. */
function monthFigures(month: string, asAt: string) {
  const from = `${month}-01`;
  const end = lastDay(month) < asAt ? lastDay(month) : asAt;
  const report = currentReport({ from, to: end })?.report;
  const grouped = report === undefined ? null : groupProfitAndLoss(report, reportLookups().classOf);
  const cash = cashBetween(from, end);
  const sheet = balanceSheetOn(end);
  const invoices = invoicesInPlay().filter(
    (i) => i.kind !== "purchase" && isPosted(i) && !isCreditNote(i) && !isEstimate(i) && inScope(i) && i.issued >= from && i.issued <= end,
  );
  const income = report?.totalIncome ?? 0;
  const net = report?.netProfit ?? 0;
  const trading = grouped?.trading.total ?? 0;
  return {
    cashReceived: cash.received,
    cashSpent: cash.spent,
    bank: bankOn(end),
    income,
    expenses: Math.abs(report?.totalExpenses ?? 0),
    grossProfit: grouped?.grossProfit ?? 0,
    netProfit: net,
    debtors: agedTotal("sales", end),
    creditors: agedTotal("purchase", end),
    netAssets: sheet.netAssets,
    invoiceCount: invoices.length,
    invoiceAverage: invoices.length === 0 ? 0 : Math.round(invoices.reduce((s, i) => s + i.total, 0) / invoices.length),
    grossMargin: trading === 0 ? null : (grouped?.grossProfit ?? 0) / trading,
    netMargin: income === 0 ? null : net / income,
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function build(year: number): HTMLElement {
  const page = document.createElement("div");
  const whole = currentReport();
  if (whole === null) {
    page.append(note("No transactions yet. Import some bank data first."));
    return page;
  }
  const { from: yearFrom, to: yearEnd } = reportRange(year);
  const today = localToday();
  const asAt = today < yearEnd ? (today < yearFrom ? yearFrom : today) : yearEnd;
  const report = whole.report;
  const grouped = groupProfitAndLoss(report, reportLookups().classOf);

  const owedToYou = agedFor("sales", asAt);
  const youOwe = agedFor("purchase", asAt);
  const overdue = owedToYou.total - owedToYou.totals.current;
  const overdueItems = owedToYou.contacts.flatMap((c) => c.items.filter((i) => i.daysOverdue > 0 && i.owing > 0));

  const heading = document.createElement("h3");
  heading.className = "dashboard-title";
  heading.textContent = `${whole.title}: the year to ${new Date(`${asAt}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
  page.append(heading);

  if (report.uncoded.count > 0) {
    const warn = document.createElement("p");
    warn.className = "variance-note warn";
    warn.textContent =
      `${report.uncoded.count} transactions this year have no code, worth ${booksMoney(Math.abs(report.uncoded.gross))}, ` +
      "and are not in the income and expense figures below.";
    page.append(warn);
  }

  page.append(
    tiles([
      { label: "Bank balance", value: booksMoney(bankOn(asAt)), note: "Every bank account" },
      { label: "Owed to you", value: booksMoney(owedToYou.total), note: "Invoices not yet paid" },
      { label: "You owe", value: booksMoney(youOwe.total), note: "Bills not yet paid" },
      { label: "Income", value: booksMoney(report.totalIncome), note: `FY${year} so far` },
      { label: "Expenses", value: booksMoney(Math.abs(report.totalExpenses)), note: `FY${year} so far` },
      {
        label: report.netProfit >= 0 ? "Net profit" : "Net loss",
        value: booksMoney(report.netProfit),
        note: `FY${year} so far`,
        tone: report.netProfit >= 0 ? "good" : "warn",
      },
      {
        label: "Overdue to you",
        value: booksMoney(overdue),
        note: `${overdueItems.length} invoice${overdueItems.length === 1 ? "" : "s"} past due`,
        ...(overdue > 0 ? { tone: "warn" as const } : {}),
      },
    ]),
  );

  // Two charts side by side where there is room.
  const pairOne = document.createElement("div");
  pairOne.className = "dashboard-pair";
  const months = monthsOfYear(year).filter((m) => m.from <= asAt);
  const balances = months.map((m) => {
    const end = m.to < asAt ? m.to : asAt;
    return { label: m.label, first: agedTotal("sales", end), second: agedTotal("purchase", end) };
  });
  pairOne.append(
    panel("Owed to you and you owe, month end by month end", lineChart(balances, { first: "Owed to you", second: "You owe" })),
    panel(`Invoices by status, FY${year}`, invoiceRing(yearFrom, asAt)),
  );
  page.append(pairOne);

  const pairTwo = document.createElement("div");
  pairTwo.className = "dashboard-pair";
  const biggest = [...grouped.operatingExpenses.lines, ...grouped.costOfSales.lines]
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10)
    .map((line) => ({ label: line.code, value: line.net }));
  const buckets: readonly (readonly [keyof typeof owedToYou.totals, string])[] = [
    ["current", "Not yet due"],
    ["1-30", "1 to 30 days"],
    ["31-60", "31 to 60"],
    ["61-90", "61 to 90"],
    ["older", "Over 90"],
  ];
  pairTwo.append(
    panel(
      `Where the money went, FY${year}`,
      biggest.length > 0 ? rankedBars(biggest) : note("No expenses coded this year yet."),
    ),
    panel(
      "Owed by how late",
      monthlyColumns(
        buckets.map(([key, label]) => ({ label, income: owedToYou.totals[key], expenses: youOwe.totals[key] })),
        { first: "Owed to you", second: "You owe", net: false },
      ),
    ),
  );
  page.append(pairTwo);

  const pairThree = document.createElement("div");
  pairThree.className = "dashboard-pair";
  pairThree.append(panel(`Profit and loss, FY${year} so far`, profitAndLoss(grouped)), panel("This month against last", comparison(asAt)));
  page.append(pairThree);

  page.append(panel("Overdue invoices, by how late", overdueTable(overdueItems)));
  page.append(
    note(
      "Every figure comes from the reports: income and expenses from the profit and loss, the bank and net assets " +
        "from the balance sheet, what is owed from the aged receivables and payables. The year, entity and basis " +
        "chosen above apply here too.",
    ),
  );
  return page;
}

function panel(title: string, content: HTMLElement): HTMLElement {
  const box = document.createElement("section");
  box.className = "dashboard-panel";
  const h = document.createElement("h4");
  h.className = "chart-heading";
  h.textContent = title;
  box.append(h, content);
  return box;
}

function tiles(items: readonly { label: string; value: string; note: string; tone?: "good" | "warn" }[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "chart-tiles";
  for (const item of items) {
    const box = document.createElement("div");
    box.className = item.tone === undefined ? "chart-tile" : `chart-tile tile-${item.tone}`;
    const label = document.createElement("span");
    label.className = "chart-tile-label";
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.className = "chart-tile-value";
    value.textContent = item.value;
    const said = document.createElement("span");
    said.className = "chart-tile-note";
    said.textContent = item.note;
    box.append(label, value, said);
    row.append(box);
  }
  return row;
}

/** Sales invoices dated in the year, by where they stand today. */
function invoiceRing(from: string, asAt: string): HTMLElement {
  const balances = new Map<Invoice, Cents>();
  for (const b of invoiceBalanceMap().values()) balances.set(b.invoice, b.remaining);
  const counts = { paid: [0, 0], owing: [0, 0], overdue: [0, 0], draft: [0, 0], voided: [0, 0] } as Record<string, [number, number]>;
  const add = (key: string, value: Cents): void => {
    const held = counts[key] as [number, number];
    held[0] += value;
    held[1] += 1;
  };
  for (const invoice of invoicesInPlay()) {
    if (invoice.kind === "purchase" || isCreditNote(invoice) || isEstimate(invoice) || !inScope(invoice)) continue;
    if (invoice.issued < from || invoice.issued > asAt) continue;
    const status = invoice.status.trim().toLowerCase();
    if (status === "voided" || status === "deleted") add("voided", invoice.total);
    else if (!isPosted(invoice)) add("draft", invoice.total);
    else {
      const remaining = balances.get(invoice) ?? invoice.outstanding;
      if (remaining <= 0) add("paid", invoice.total);
      else if ((invoice.due ?? invoice.issued) < asAt) add("overdue", remaining);
      else add("owing", remaining);
    }
  }
  const slice = (key: string, label: string, series: RingSlice["series"]): RingSlice => {
    const [value, count] = counts[key] as [number, number];
    return { label, value, series, note: `${count}` };
  };
  const all = Object.values(counts).reduce((s, [, n]) => s + n, 0);
  if (all === 0) return note("No sales invoices dated this year.");
  return ringChart(
    [
      slice("paid", "Paid", 1),
      slice("owing", "Owing, not yet due", 3),
      slice("overdue", "Overdue", 2),
      slice("draft", "Draft", 4),
      slice("voided", "Voided", 5),
    ],
    `${all} invoice${all === 1 ? "" : "s"}`,
  );
}

function profitAndLoss(grouped: ReturnType<typeof groupProfitAndLoss>): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table dashboard-table";
  const tbody = document.createElement("tbody");
  const row = (label: string, cents: Cents | null, cls = ""): void => {
    const tr = document.createElement("tr");
    if (cls !== "") tr.className = cls;
    tr.append(nameCell(label), amountCell(cents === null ? "" : booksMoney(cents)));
    tbody.append(tr);
  };
  const group = (g: ReturnType<typeof groupProfitAndLoss>["trading"], most = 99): void => {
    if (g.lines.length === 0) return;
    row(g.title, null, "report-section");
    const sorted = [...g.lines].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    for (const line of sorted.slice(0, most)) row(line.code, Math.abs(line.net));
    const rest = sorted.slice(most);
    if (rest.length > 0) row(`${rest.length} more`, rest.reduce((s, l) => s + Math.abs(l.net), 0));
    row(`Total ${g.title.toLowerCase()}`, g.total, "report-total");
  };
  group(grouped.trading);
  group(grouped.costOfSales);
  if (grouped.costOfSales.lines.length > 0) row("Gross profit", grouped.grossProfit, "report-total");
  group(grouped.otherIncome);
  group(grouped.operatingExpenses, 12);
  row(grouped.netProfit >= 0 ? "Net profit" : "Net loss", grouped.netProfit, "report-total");
  table.append(tbody);
  return table;
}

/** This month so far against the whole of last month, each with the change. */
function comparison(asAt: string): HTMLElement {
  const month = asAt.slice(0, 7);
  const before = monthBefore(month);
  const now = monthFigures(month, asAt);
  const then = monthFigures(before, asAt);
  const table = document.createElement("table");
  table.className = "report-table dashboard-table";
  table.innerHTML = `<thead><tr><th></th><th>${monthName(month)}</th><th>${monthName(before)}</th><th>Change</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  const section = (title: string): void => {
    const tr = document.createElement("tr");
    tr.className = "report-section";
    const cell = nameCell(title);
    cell.colSpan = 4;
    tr.append(cell);
    tbody.append(tr);
  };
  const percent = (share: number | null): string => (share === null ? "—" : `${Math.round(share * 1000) / 10}%`);
  /** `up`: whether a rise is good news (income), bad news (expenses), or neither. */
  const row = (label: string, a: number | null, b: number | null, shown: (n: number | null) => string, up: "good" | "bad" | "none"): void => {
    const tr = document.createElement("tr");
    const change = document.createElement("td");
    change.className = "report-amount";
    if (a !== null && b !== null && a !== b) {
      const rise = a > b;
      const by = b === 0 ? null : (a - b) / Math.abs(b);
      change.textContent = `${rise ? "▲" : "▼"} ${by === null ? "new" : `${Math.abs(Math.round(by * 1000) / 10)}%`}`;
      if (up !== "none") change.className += (rise === (up === "good")) ? " change-good" : " change-bad";
    }
    tr.append(nameCell(label), amountCell(shown(a)), amountCell(shown(b)), change);
    tbody.append(tr);
  };
  const money = (n: number | null): string => (n === null ? "—" : booksMoney(n));
  section("Cash");
  row("Money in", now.cashReceived, then.cashReceived, money, "good");
  row("Money out", now.cashSpent, then.cashSpent, money, "bad");
  row("Bank at the month end", now.bank, then.bank, money, "good");
  section("Profit");
  row("Income", now.income, then.income, money, "good");
  row("Expenses", now.expenses, then.expenses, money, "bad");
  row("Gross profit", now.grossProfit, then.grossProfit, money, "good");
  row("Net profit", now.netProfit, then.netProfit, money, "good");
  row("Gross margin", now.grossMargin, then.grossMargin, percent, "good");
  row("Net margin", now.netMargin, then.netMargin, percent, "good");
  section("Position");
  row("Owed to you", now.debtors, then.debtors, money, "none");
  row("You owe", now.creditors, then.creditors, money, "none");
  row("Net assets", now.netAssets, then.netAssets, money, "good");
  section("Invoices");
  row("Invoices sent", now.invoiceCount, then.invoiceCount, (n) => (n === null ? "—" : String(n)), "good");
  row("Average invoice", now.invoiceAverage, then.invoiceAverage, money, "none");
  table.append(tbody);
  const wrap = document.createElement("div");
  wrap.append(table, note(`${monthName(month)} is to ${asAt}; ${monthName(before)} is the whole month.`));
  return wrap;
}

function overdueTable(items: readonly { invoice: Invoice; owing: Cents; daysOverdue: number }[]): HTMLElement {
  if (items.length === 0) return note("Nothing owed to you is overdue.");
  const table = document.createElement("table");
  table.className = "report-table dashboard-table";
  table.innerHTML = "<thead><tr><th>Customer</th><th>Invoice</th><th>Due</th><th>Owing</th><th>Days late</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const sorted = [...items].sort((a, b) => b.daysOverdue - a.daysOverdue);
  for (const item of sorted.slice(0, 15)) {
    const tr = document.createElement("tr");
    const late = amountCell(String(item.daysOverdue));
    if (item.daysOverdue > 60) late.classList.add("change-bad");
    tr.append(
      nameCell(item.invoice.contact),
      nameCell(item.invoice.number),
      nameCell(item.invoice.due ?? item.invoice.issued),
      amountCell(booksMoney(item.owing)),
      late,
    );
    tbody.append(tr);
  }
  table.append(tbody);
  const wrap = document.createElement("div");
  wrap.append(table);
  if (sorted.length > 15) wrap.append(note(`And ${sorted.length - 15} more: the aged receivables report lists them all.`));
  return wrap;
}
