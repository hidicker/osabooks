import { balancesOn, compareBalances, movementsBetween, postedFromImported, sectionForType } from "@nzosa/core";
import type { AccountComparison, AccountDifference, Cents, IsoDate } from "@nzosa/core";
import { showPage } from "../app.js";
import { bankAccountsByCode, bankLabel, ledgerAccountFor, postedJournals, recomputeVariance } from "../books.js";
import { booksLocale, booksMoney } from "../country.js";
import { state } from "../state.js";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { note } from "../ui.js";
import { reviewDisclaimer } from "../ai-review.js";
import { reviewsFor } from "./ai-check-page.js";
import { irdSummary } from "./ird-records.js";
import {
  codingReconciliationWaiting,
  compareWithReference,
  unmatchedReferenceWaiting,
} from "../migrate/coding-reconciliation.js";

/**
 * A set of books brought in from Xero, checked: one page that says what
 * agrees with Xero, what does not, and where to look.
 *
 * For somebody who has just moved their Xero books across, and for their
 * accountant. Every figure on it comes from what another page already works
 * out -- the coding reconciliation, the GST reconciliation, the IRD records,
 * the AI accounts check -- so the summary and the page behind each part can
 * never disagree. The one thing worked out here is the account-by-account
 * comparison with Xero, from `xero-check.ts` in the core.
 *
 * It is useful early and complete late: straight after the move most of the
 * coding is still to be checked, and each part says what is still to load or
 * to do rather than showing an empty box.
 */

type Tone = "good" | "look" | "none";

interface Tile {
  label: string;
  value: string;
  tone: Tone;
  target: string;
}

/** A difference of a cent or less agrees: two systems can round a line differently. */
const TOLERANCE: Cents = 1;

export function renderXeroCheck(body: HTMLElement, year: number): void {
  const page = document.createElement("div");
  page.className = "xcheck";

  const heading = document.createElement("h3");
  heading.className = "xcheck-title";
  heading.textContent = `Your Xero books, checked: the year to ${taxYearEndSaid(year)}`;
  const when = document.createElement("p");
  when.className = "page-hint";
  when.textContent =
    `Worked out ${new Date().toLocaleString(booksLocale())}. Each part comes from the page it links to, ` +
    "so what it says here is what that page says.";
  page.append(heading, when, loadedList());

  const accounts = accountsPart(year);
  const gst = gstPart();
  const ird = irdPart();
  const coding = codingPart();
  const ai = aiPart(year);

  page.append(tiles([accounts.tile, gst.tile, ird.tile, coding.tile, ai.tile]));
  page.append(accounts.section, gst.section, ird.section, coding.section, ai.section);

  const print = document.createElement("button");
  print.type = "button";
  print.textContent = "Print or save as PDF";
  print.addEventListener("click", () => window.print());
  const foot = document.createElement("div");
  foot.className = "page-actions xcheck-foot";
  foot.append(print);
  page.append(foot);

  body.append(page);
}

// --- what is loaded ----------------------------------------------------------

/** What has been brought across from Xero, each with a tick or where to load it. */
function loadedList(): HTMLElement {
  const list = document.createElement("ul");
  list.className = "xcheck-loaded";
  const opening = state.ledger.openingBalances;
  const items: [boolean, string, string, string][] = [
    [state.chart.length > 0, "Chart of accounts", "Load it on Initial set-up", "setup"],
    [opening !== undefined, "Trial balance (opening balances)", "Load it on Opening balances", "opening"],
    [(state.ledger.journals ?? []).length > 0, "Journal report", "Load it on Coding reconciliation", "check"],
    [state.reference.length > 0, "Account transactions (Xero's coding)", "Load it on Coding reconciliation", "check"],
    [(state.ledger.invoices ?? []).length > 0, "Invoices and bills", "Load them on Invoices", "invoices"],
    [state.ledger.transactions.length > 0, "Bank lines", "Bring them in on Bank import", "import"],
    [(state.ledger.irdRecords ?? []).length > 0, "Inland Revenue (myIR) files", "Load them on IRD records", "ird"],
  ];
  for (const [have, what, where, target] of items) {
    const item = document.createElement("li");
    item.className = have ? "xcheck-have" : "xcheck-missing";
    item.append(`${have ? "✓" : "○"} ${what}`);
    if (!have) {
      item.append(" — ");
      item.append(link(where, target));
    }
    list.append(item);
  }
  return list;
}

// --- accounts against Xero ---------------------------------------------------

/** The name an account goes by: the chart's, or a bank account's own. */
function accountName(key: string): string {
  const row = state.chart.find((a) => a.code === key);
  if (row !== undefined) return `${row.code} ${row.name}`;
  return bankLabel(key);
}

/** A difference said in words, where the reason is a usual one. */
function reasonFor(d: AccountDifference): string {
  const row = state.chart.find((a) => a.code === d.account);
  const name = (row?.name ?? "").toLowerCase();
  const type = (row?.type ?? "").toLowerCase();
  if ((type === "depreciation" || /depreciation/.test(name)) && d.theirs === 0) {
    return "Xero has no depreciation for this year yet; these books do.";
  }
  if (type === "retained earnings") return "Follows from the other differences: it is where the year's profit goes.";
  if (row === undefined && /uncoded/i.test(d.account)) return "Bank lines not coded yet here; Xero has them in an account.";
  return "";
}

/** A day as the books write it: 1 April 2026. */
function daySaid(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(booksLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function comparisonTable(result: AccountComparison, theirsLabel: string): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table xcheck-table";
  table.innerHTML =
    `<thead><tr><th>Account</th><th class="report-amount">${theirsLabel}</th>` +
    `<th class="report-amount">These books</th><th class="report-amount">Difference</th><th>Why</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const d of result.differences) {
    const tr = document.createElement("tr");
    const cells: [string, string][] = [
      [accountName(d.account), ""],
      [booksMoney(d.theirs), "report-amount"],
      [booksMoney(d.ours), "report-amount"],
      [booksMoney(d.difference), "report-amount"],
      [reasonFor(d), ""],
    ];
    for (const [text, className] of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      if (className !== "") td.className = className;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

/** Keys from Xero (a numbered bank) put under the ledger's own. */
function rekey(balances: Record<string, Cents>): Record<string, Cents> {
  const byCode = bankAccountsByCode();
  const out: Record<string, Cents> = {};
  for (const [key, amount] of Object.entries(balances)) {
    const to = byCode.get(key) ?? key;
    out[to] = ((out[to] ?? 0) + amount) as Cents;
  }
  return out;
}

function accountsPart(year: number): { tile: Tile; section: HTMLElement } {
  const section = part("Accounts against Xero", "xcheck-accounts");
  const opening = state.ledger.openingBalances;
  const from = taxYearStart(year);
  const to = taxYearEnd(year);
  const ours = postedJournals();
  const isProfitAndLoss = (key: string): boolean => {
    const row = state.chart.find((a) => a.code === key);
    return row !== undefined && sectionForType(row.type) !== null;
  };
  const retained = state.chart.find((a) => a.type.trim().toLowerCase() === "retained earnings")?.code ?? "960";

  let compared = 0;
  let agree = 0;
  let any = false;

  // The year end, from Xero's trial balance, where it has a column for it.
  const column = opening?.byDate?.[to];
  if (opening !== undefined && column !== undefined) {
    const mine = balancesOn(opening, ours, to as IsoDate, isProfitAndLoss, retained);
    if (mine !== null) {
      any = true;
      const result = compareBalances(rekey(column), mine, TOLERANCE);
      compared += result.compared;
      agree += result.agree;
      const h = document.createElement("h4");
      h.textContent = `Balances at ${taxYearEndSaid(year)}, against Xero's trial balance`;
      section.append(h);
      section.append(
        result.differences.length === 0
          ? said(`Every one of the ${result.compared} balance-sheet accounts agrees.`, "good")
          : said(`${result.agree} of ${result.compared} balance-sheet accounts agree. These differ:`, "look"),
      );
      if (result.differences.length > 0) section.append(comparisonTable(result, "Xero"));
    }
  }

  // The year's movement on every account, income and expenses included, from
  // Xero's journal report, up to the last day it covers.
  const journals = state.ledger.journals ?? [];
  if (journals.length > 0) {
    const chartByName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
    const theirs = postedFromImported(journals, (name) => ledgerAccountFor(name, chartByName.get(name.trim().toLowerCase())));
    const last = journals.reduce((max, j) => (j.date > max ? j.date : max), "");
    const start = opening !== undefined && opening.asAt > from ? opening.asAt : from;
    const end = last !== "" && last < to ? last : to;
    if (start <= end) {
      any = true;
      const result = compareBalances(
        rekey(movementsBetween(theirs, start as IsoDate, end as IsoDate)),
        movementsBetween(ours, start as IsoDate, end as IsoDate),
        TOLERANCE,
      );
      compared += result.compared;
      agree += result.agree;
      const h = document.createElement("h4");
      h.textContent = `The year's movement on each account, ${daySaid(start)} to ${daySaid(end)}, against Xero's journal report`;
      section.append(h);
      section.append(
        result.differences.length === 0
          ? said(`Every one of the ${result.compared} accounts moved by the same amount in both, income and expenses included.`, "good")
          : said(`${result.agree} of ${result.compared} accounts agree. These differ:`, "look"),
      );
      if (result.differences.length > 0) section.append(comparisonTable(result, "Xero"));
    }
  }

  if (!any) {
    section.append(
      note(
        "Nothing of Xero's to compare yet for this year. Load Xero's trial balance with a column for " +
          `${taxYearEndSaid(year)} on Opening balances, or its journal report on Coding reconciliation.`,
      ),
    );
  }
  section.append(linkLine("Open the balance sheet", () => showPageReport("balancesheet")));

  const tile: Tile = !any
    ? { label: "Accounts", value: "Nothing to compare yet", tone: "none", target: "xcheck-accounts" }
    : {
        label: "Accounts against Xero",
        value: `${agree} of ${compared} agree`,
        tone: agree === compared ? "good" : "look",
        target: "xcheck-accounts",
      };
  return { tile, section };
}

// --- GST returns --------------------------------------------------------------

function gstPart(): { tile: Tile; section: HTMLElement } {
  const section = part("GST returns", "xcheck-gst");
  if (state.filed.length === 0) {
    section.append(note("No filed GST returns loaded. Load Xero's GST returns, or Inland Revenue's, on GST reconciliation."));
    section.append(linkLine("Go to GST reconciliation", () => showPage("gst")));
    return { tile: { label: "GST returns", value: "None loaded", tone: "none", target: "xcheck-gst" }, section };
  }
  recomputeVariance();
  const rows = state.varianceRows;
  const settled = rows.filter((r) => r.left !== null && Math.abs(r.left) <= 100);
  const table = document.createElement("table");
  table.className = "report-table xcheck-table";
  table.innerHTML =
    '<thead><tr><th>Period to</th><th class="report-amount">Filed</th><th class="report-amount">These books</th>' +
    '<th class="report-amount">Difference</th><th class="report-amount">Explained</th><th>Status</th></tr></thead>';
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const ok = r.left !== null && Math.abs(r.left) <= 100;
    const cells: [string, string][] = [
      [daySaid(r.periodEnd), ""],
      [booksMoney(r.filed), "report-amount"],
      [r.ours === null ? "—" : booksMoney(r.ours), "report-amount"],
      [r.difference === null ? "—" : booksMoney(r.difference), "report-amount"],
      [booksMoney(r.explained), "report-amount"],
      [r.ours === null ? "Not in these books" : ok ? "Agrees or explained" : `${booksMoney(r.left ?? 0)} to explain`, ok ? "xcheck-ok" : "xcheck-look"],
    ];
    for (const [text, className] of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      if (className !== "") td.className = className;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  section.append(
    said(
      settled.length === rows.length
        ? `All ${rows.length} filed returns agree with these books, or the difference is explained.`
        : `${settled.length} of ${rows.length} filed returns agree or are explained.`,
      settled.length === rows.length ? "good" : "look",
    ),
    table,
    note("GST on sales less GST on purchases (boxes 8 and 12). Late claims and corrections in boxes 9 and 13 are left out, as no bank line holds them."),
    linkLine("Go to GST reconciliation", () => showPage("gst")),
  );
  return {
    tile: {
      label: "GST returns",
      value: `${settled.length} of ${rows.length} explained`,
      tone: settled.length === rows.length ? "good" : "look",
      target: "xcheck-gst",
    },
    section,
  };
}

// --- Inland Revenue -----------------------------------------------------------

function irdPart(): { tile: Tile; section: HTMLElement } {
  const section = part("Inland Revenue", "xcheck-ird");
  const records = irdSummary();
  if (records.length === 0) {
    section.append(
      note(
        "No myIR files loaded. Inland Revenue's own record (the GST returns it holds, what was paid " +
          "and refunded, the income tax account) is the last word on what was filed, and checking the " +
          "books against it is the surest test there is.",
      ),
      linkLine("Go to IRD records", () => showPage("ird")),
    );
    return { tile: { label: "Inland Revenue", value: "No myIR files", tone: "none", target: "xcheck-ird" }, section };
  }
  const agrees = records.reduce((s, r) => s + r.agrees, 0);
  const differs = records.reduce((s, r) => s + r.differs, 0);
  const list = document.createElement("table");
  list.className = "report-table xcheck-table";
  list.innerHTML =
    '<thead><tr><th>Record</th><th>Covers</th><th class="report-amount">Agree</th>' +
    '<th class="report-amount">To look at</th><th class="report-amount">Not in these books</th></tr></thead>';
  const tbody = document.createElement("tbody");
  for (const r of records) {
    const tr = document.createElement("tr");
    for (const [text, className] of [
      [r.what, ""],
      [r.when, ""],
      [String(r.agrees), "report-amount"],
      [String(r.differs), r.differs > 0 ? "report-amount xcheck-look" : "report-amount"],
      [String(r.notHeld), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      if (className !== "") td.className = className;
      tr.append(td);
    }
    tbody.append(tr);
  }
  list.append(tbody);
  section.append(
    said(
      differs === 0
        ? `All ${agrees} figures checked against Inland Revenue's agree.`
        : `${agrees} figures agree with Inland Revenue's; ${differs} to look at.`,
      differs === 0 ? "good" : "look",
    ),
    list,
  );
  const looks = records.flatMap((r) => r.differences.map((d) => ({ record: r.what, check: d })));
  if (looks.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "xcheck-list";
    for (const { record, check } of looks.slice(0, 20)) {
      const li = document.createElement("li");
      li.textContent =
        `${record}, ${check.group}: ${check.label}. Inland Revenue ${check.ird === null ? "—" : booksMoney(check.ird)}, ` +
        `these books ${check.ours === null ? "—" : booksMoney(check.ours)}` + (check.note ? `. ${check.note}` : "");
      ul.append(li);
    }
    section.append(ul);
  }
  section.append(linkLine("Go to IRD records", () => showPage("ird")));
  return {
    tile: {
      label: "Inland Revenue",
      value: differs === 0 ? `${agrees} figures agree` : `${differs} to look at`,
      tone: differs === 0 ? "good" : "look",
      target: "xcheck-ird",
    },
    section,
  };
}

// --- coding -------------------------------------------------------------------

function codingPart(): { tile: Tile; section: HTMLElement } {
  const section = part("How the lines were coded", "xcheck-coding");
  if (state.reference.length === 0 || state.ledger.transactions.length === 0) {
    section.append(
      note("Load Xero's Account Transactions on Coding reconciliation to compare how each bank line was coded there and here."),
      linkLine("Go to Coding reconciliation", () => showPage("check")),
    );
    return { tile: { label: "Coding", value: "Not compared yet", tone: "none", target: "xcheck-coding" }, section };
  }
  const { result } = compareWithReference();
  const matched = result.agreed.length + result.differed.length + result.uncoded.length;
  const waiting = codingReconciliationWaiting();
  const missing = unmatchedReferenceWaiting();
  const items: [string, number][] = [
    ["bank lines matched to a line in Xero", matched],
    ["coded the same as in Xero", result.agreed.length],
    ["coded differently", result.differed.length],
    ["still to decide on Coding reconciliation", waiting],
    ["lines in Xero's file not in these books, and not explained", missing],
  ];
  const ul = document.createElement("ul");
  ul.className = "xcheck-list";
  for (const [what, count] of items) {
    const li = document.createElement("li");
    li.textContent = `${count} ${what}`;
    ul.append(li);
  }
  const done = waiting === 0 && missing === 0;
  section.append(
    said(
      done
        ? "Every line has been worked through on Coding reconciliation."
        : "Worth finishing on Coding reconciliation before relying on the rest: until then some differences above are only lines not yet decided.",
      done ? "good" : "look",
    ),
    ul,
    linkLine("Go to Coding reconciliation", () => showPage("check")),
  );
  return {
    tile: {
      label: "Coding",
      value: done ? "All worked through" : `${waiting + missing} still to decide`,
      tone: done ? "good" : "look",
      target: "xcheck-coding",
    },
    section,
  };
}

// --- the AI accounts check ----------------------------------------------------

function aiPart(year: number): { tile: Tile; section: HTMLElement } {
  const section = part("AI accounts check", "xcheck-ai");
  const reviews = reviewsFor(year);
  if (reviews.length === 0) {
    section.append(
      note(
        "Not run for this year. The AI accounts check reads the finished year against the tax rules, " +
          "with OpenAccountants' guides: whether each account holds what belongs in it, the GST treatments, " +
          "and what is usually present but missing.",
      ),
      linkLine("Go to the AI accounts check", () => showPage("aicheck")),
    );
    return { tile: { label: "AI accounts check", value: "Not run yet", tone: "none", target: "xcheck-ai" }, section };
  }
  for (const r of reviews) {
    const h = document.createElement("h4");
    h.textContent = `${r.title}, pasted back ${new Date(r.at).toLocaleDateString()}`;
    const text = document.createElement("pre");
    text.className = "ai-prompt";
    text.textContent = r.text;
    section.append(h, text);
  }
  section.append(reviewDisclaimer(), linkLine("Go to the AI accounts check", () => showPage("aicheck")));
  const latest = reviews[0];
  return {
    tile: {
      label: "AI accounts check",
      value: latest === undefined ? "Not run yet" : `Checked ${new Date(latest.at).toLocaleDateString()}`,
      tone: "good",
      target: "xcheck-ai",
    },
    section,
  };
}

// --- small builders -----------------------------------------------------------

function part(title: string, id: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "xcheck-part";
  section.id = id;
  const h = document.createElement("h3");
  h.textContent = title;
  section.append(h);
  return section;
}

function said(text: string, tone: Tone): HTMLElement {
  const p = document.createElement("p");
  p.className = `xcheck-said xcheck-${tone}`;
  p.textContent = text;
  return p;
}

function link(text: string, page: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = text;
  button.addEventListener("click", () => showPage(page as Parameters<typeof showPage>[0]));
  return button;
}

function linkLine(text: string, go: () => void): HTMLElement {
  const p = document.createElement("p");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = `${text} →`;
  button.addEventListener("click", go);
  p.append(button);
  return p;
}

/** Another report, chosen in the report picker on this same page. */
function showPageReport(kind: string): void {
  const select = document.getElementById("report-kind");
  if (!(select instanceof HTMLSelectElement)) return;
  select.value = kind;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function tiles(list: readonly Tile[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "xcheck-tiles";
  for (const t of list) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `xcheck-tile xcheck-${t.tone}`;
    const label = document.createElement("span");
    label.className = "xcheck-tile-label";
    label.textContent = t.label;
    const value = document.createElement("strong");
    value.textContent = t.value;
    tile.append(label, value);
    tile.addEventListener("click", () => document.getElementById(t.target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    row.append(tile);
  }
  return row;
}
