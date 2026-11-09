import { redraw } from "../app.js";
import { asCsvText, saveManualJournals } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { note, noteBriefly, tellOnPage, wideTable } from "../ui.js";
import {
  PAY_ACCOUNTS,
  PAY_AMOUNTS,
  REGISTER_ROLE_LABELS,
  employeeTaxes,
  employerTaxes,
  findPayAccounts,
  payAccountsUsed,
  payrollRegisterId,
  payrollRegisterJournal,
  payrollService,
  readPayrollRegister,
  registerPaydays,
  w2Figures,
} from "@nzosa/core";
import type { Account, ManualJournal, PayAccount, RegisterPayday, RegisterRead, RegisterRole } from "@nzosa/core";

/**
 * Payroll for United States books: the payroll service's register brought in,
 * a journal for each payday, and each employee's year read back for the W-2s.
 *
 * The service works out the pay and the taxes and files the 941s and W-2s;
 * OsaBooks keeps the books of it. Each payday posts gross wages and the
 * employer's taxes as costs, and what is owed (net pay, each tax, deductions)
 * to the accounts the Form 941 worksheet reads. The net pay and the tax
 * deposits then leave the bank and are coded to those same accounts.
 */

const money = (cents: number): string => booksMoney(cents);

/** The file being brought in, until it is posted or put aside. */
let loaded: { name: string; service: string; read: RegisterRead } | null = null;
/** The account chosen for each part: an account code, or "" to add the one named. */
const chosen = new Map<PayAccount, string>();

const ROLES: readonly RegisterRole[] = ["skip", "date", "employee", "firstName", "lastName", ...PAY_AMOUNTS];

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function cell(text: string, amount = false): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  if (amount) td.className = "report-amount";
  return td;
}

function table(headings: readonly string[], amountsFrom: number): [HTMLTableElement, HTMLTableSectionElement] {
  const t = document.createElement("table");
  t.className = "report-table";
  const head = document.createElement("thead");
  const tr = document.createElement("tr");
  headings.forEach((h, i) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (i >= amountsFrom) th.className = "report-amount";
    tr.append(th);
  });
  head.append(tr);
  const body = document.createElement("tbody");
  t.append(head, body);
  return [t, body];
}

const label = (a: Account): string => `${a.name} - ${a.code}`;

/** The payroll journals already in the books, by date. */
function payrollJournals(): ManualJournal[] {
  return (state.ledger.manualJournals ?? []).filter(
    (j) => j.deleted === undefined && j.reverses === undefined && (/^payroll/i.test(j.id) || /payroll register/i.test(j.source ?? "")),
  );
}

function alreadyIn(date: string): boolean {
  return payrollJournals().some((j) => j.date === date || j.id === payrollRegisterId(date));
}

/** A free code near `start`, for an account the books lack. */
function freeCode(start: number, taken: Set<string>): string {
  let n = start;
  while (taken.has(String(n))) n += 1;
  taken.add(String(n));
  return String(n);
}

/** The accounts the paydays post to, adding to the chart any the books lack. */
function settleAccounts(used: readonly PayAccount[]): Partial<Record<PayAccount, string>> {
  const taken = new Set(state.chart.map((a) => a.code.trim()));
  const found = findPayAccounts(state.chart);
  const added: Account[] = [];
  const out: Partial<Record<PayAccount, string>> = {};
  for (const id of used) {
    const code = chosen.get(id) ?? found[id]?.code ?? "";
    const account = state.chart.find((a) => a.code.trim() === code);
    if (account !== undefined) {
      out[id] = label(account);
      continue;
    }
    const spec = PAY_ACCOUNTS.find((a) => a.id === id);
    if (spec === undefined) continue;
    const fresh = {
      code: freeCode(spec.type === "Expense" ? 6300 : 2100, taken),
      name: spec.name,
      type: spec.type,
      taxCode: "Tax Exempt",
      description: "",
    } as Account;
    added.push(fresh);
    chosen.set(id, fresh.code);
    out[id] = label(fresh);
  }
  if (added.length > 0) {
    state.chart = [...state.chart, ...added];
    const model = state.ledger.entities;
    const owner = model?.entities.find((e) => e.kind !== "personal" && e.kind !== "residential")?.id ?? model?.entities[0]?.id;
    state.ledger = {
      ...state.ledger,
      chart: state.chart,
      ...(model !== undefined && owner !== undefined
        ? { entities: { ...model, accounts: { ...model.accounts, ...Object.fromEntries(added.map((a) => [a.code, owner])) } } }
        : {}),
    };
  }
  return out;
}

function fileSection(body: HTMLElement): void {
  body.append(
    heading("Bring in a payroll register"),
    note(
      "Download the payroll register from the payroll service, one row for each employee on each payday: in Gusto, " +
        "Reports, Payroll journal, by employee, as CSV or Excel. Each payday becomes a journal: gross wages and the " +
        "employer's taxes as costs, and the net pay, each tax and the deductions as owed until the bank pays them.",
    ),
  );
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,.xlsx,.xls,.txt";
  input.setAttribute("aria-label", "Payroll register file");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    void file.arrayBuffer().then(async (buffer) => {
      const text = await asCsvText(file.name, new Uint8Array(buffer));
      const read = readPayrollRegister(text);
      if (read === null) {
        await tellOnPage(
          `${file.name} has no row of headings with a check date and gross or net pay. Download the register with one row for each employee on each payday.`,
        );
        return;
      }
      loaded = { name: file.name, service: payrollService(file.name, text), read };
      chosen.clear();
      redraw("uspayroll");
    });
  });
  body.append(input);
}

function columnsSection(body: HTMLElement, read: RegisterRead): void {
  body.append(heading(`Columns in ${loaded?.name ?? "the file"}`));
  body.append(note("What each column holds, read from its heading. Change any that is wrong; a column not used is left out."));
  const [t, rows] = table(["Heading", "First value", "Holds"], 9);
  const first = read.rows[0]?.fields ?? [];
  for (const column of read.columns) {
    if (column.heading.trim() === "" && (first[column.index] ?? "") === "") continue;
    const tr = document.createElement("tr");
    const choose = document.createElement("select");
    choose.setAttribute("aria-label", `What ${column.heading} holds`);
    for (const role of ROLES) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = REGISTER_ROLE_LABELS[role];
      choose.append(option);
    }
    choose.value = column.role;
    choose.addEventListener("change", () => {
      column.role = choose.value as RegisterRole;
      redraw("uspayroll");
    });
    const holds = document.createElement("td");
    holds.append(choose);
    tr.append(cell(column.heading), cell(first[column.index] ?? ""), holds);
    rows.append(tr);
  }
  body.append(wideTable(t));
}

function accountsSection(body: HTMLElement, used: readonly PayAccount[]): void {
  body.append(heading("Accounts"));
  body.append(
    note("Where each part posts. The tax accounts are the ones the Form 941 worksheet reads; one the books lack is added under the name shown."),
  );
  const found = findPayAccounts(state.chart);
  const [t, rows] = table(["Part", "Account"], 9);
  for (const id of used) {
    const spec = PAY_ACCOUNTS.find((a) => a.id === id);
    if (spec === undefined) continue;
    const expense = spec.type === "Expense";
    const choose = document.createElement("select");
    choose.setAttribute("aria-label", `Account for ${spec.name}`);
    const add = document.createElement("option");
    add.value = "";
    add.textContent = `Add "${spec.name}"`;
    choose.append(add);
    for (const account of state.chart) {
      const fits = expense ? /expense|overhead|direct/i.test(account.type) : /liab/i.test(account.type);
      if (!fits || account.code.trim() === "") continue;
      const option = document.createElement("option");
      option.value = account.code.trim();
      option.textContent = label(account);
      choose.append(option);
    }
    choose.value = chosen.get(id) ?? found[id]?.code ?? "";
    choose.addEventListener("change", () => chosen.set(id, choose.value));
    const where = document.createElement("td");
    where.append(choose);
    const tr = document.createElement("tr");
    tr.append(cell(spec.name), where);
    rows.append(tr);
  }
  body.append(wideTable(t));
}

function status(day: RegisterPayday): string {
  if (day.problems.length > 0) return day.problems[0] ?? "";
  if (day.outBy !== 0) return `Out by ${money(day.outBy)}: gross less taxes and deductions is not the net pay`;
  if (alreadyIn(day.date)) return "Already in the books";
  return "Ready";
}

function paydaysSection(body: HTMLElement, days: readonly RegisterPayday[]): void {
  body.append(heading("Paydays"));
  const [t, rows] = table(["Check date", "Employees", "Gross pay", "Taxes withheld", "Deductions", "Net pay", "Employer taxes", "Status"], 2);
  for (const day of days) {
    const tr = document.createElement("tr");
    const said = cell(status(day));
    said.className = "report-name";
    tr.append(
      cell(day.date),
      cell(String(day.pays.length)),
      cell(money(day.totals.gross), true),
      cell(money(employeeTaxes(day.totals)), true),
      cell(money(day.totals.deduction), true),
      cell(money(day.totals.net), true),
      cell(money(employerTaxes(day.totals)), true),
      said,
    );
    rows.append(tr);
  }
  body.append(wideTable(t));
  const ready = days.filter((d) => status(d) === "Ready");
  const actions = document.createElement("div");
  actions.className = "page-actions";
  const post = document.createElement("button");
  post.type = "button";
  post.className = "primary";
  post.textContent = ready.length === 1 ? "Post 1 payday" : `Post ${ready.length} paydays`;
  post.disabled = ready.length === 0;
  post.addEventListener("click", () => void postPaydays(ready));
  const drop = document.createElement("button");
  drop.type = "button";
  drop.textContent = "Put this file aside";
  drop.addEventListener("click", () => {
    loaded = null;
    chosen.clear();
    redraw("uspayroll");
  });
  actions.append(post, drop);
  body.append(actions);
  const skipped = days.length - ready.length;
  if (skipped > 0) {
    body.append(note(`${skipped === 1 ? "1 payday is" : `${skipped} paydays are`} not posted: a payday already in the books is left as it is, and one that does not add up waits for its columns to be put right.`));
  }
}

async function postPaydays(days: readonly RegisterPayday[]): Promise<void> {
  if (loaded === null || days.length === 0) return;
  const accounts = settleAccounts(payAccountsUsed(days));
  const journals: ManualJournal[] = [];
  for (const day of days) {
    const journal = payrollRegisterJournal(day, accounts, loaded.service);
    if (journal !== null) journals.push(journal);
  }
  if (journals.length === 0) return;
  const service = loaded.service;
  await saveManualJournals(
    [...(state.ledger.manualJournals ?? []), ...journals],
    `Payroll register from ${service}: ${journals.length === 1 ? "1 payday" : `${journals.length} paydays`}`,
  );
  loaded = null;
  chosen.clear();
  noteBriefly(`${journals.length === 1 ? "1 payday" : `${journals.length} paydays`} posted. Code the net pay and the tax deposits on the bank to the same accounts.`);
  redraw("uspayroll");
}

function inBooksSection(body: HTMLElement): void {
  const journals = payrollJournals().sort((a, b) => b.date.localeCompare(a.date));
  body.append(heading("Payroll in the books"));
  if (journals.length === 0) {
    body.append(note("No payroll journals yet."));
    return;
  }
  const years = [...new Set(journals.map((j) => Number(j.date.slice(0, 4))))].sort((a, b) => b - a);
  const read = journals.filter((j) => j.lines.some((l) => l.employee !== undefined));
  body.append(
    note(
      `${journals.length === 1 ? "1 payroll journal" : `${journals.length} payroll journals`}, ${journals[journals.length - 1]?.date} to ${journals[0]?.date}. ` +
        "Each is on the Journal report, and History can undo a register brought in.",
    ),
  );
  if (read.length === 0) {
    body.append(note("The W-2 figures are read from journals brought in from a payroll register; these were entered another way."));
    return;
  }
  for (const year of years) {
    const figures = w2Figures(read, year);
    if (figures.length === 0) continue;
    body.append(heading(`W-2 check, ${year}`));
    const [t, rows] = table(
      ["Employee", "Paydays", "Gross wages", "Federal income tax (box 2)", "Social Security (box 4)", "Medicare (box 6)", "State income tax (box 17)"],
      1,
    );
    const sum = { gross: 0, federal: 0, socialSecurity: 0, medicare: 0, stateIncome: 0 };
    for (const e of figures) {
      const tr = document.createElement("tr");
      tr.append(
        cell(e.employee),
        cell(String(e.paydays), true),
        cell(money(e.gross), true),
        cell(money(e.federal), true),
        cell(money(e.socialSecurity), true),
        cell(money(e.medicare), true),
        cell(money(e.stateIncome), true),
      );
      rows.append(tr);
      sum.gross += e.gross;
      sum.federal += e.federal;
      sum.socialSecurity += e.socialSecurity;
      sum.medicare += e.medicare;
      sum.stateIncome += e.stateIncome;
    }
    const total = document.createElement("tr");
    total.className = "report-total";
    total.append(
      cell("Total"),
      cell(""),
      cell(money(sum.gross), true),
      cell(money(sum.federal), true),
      cell(money(sum.socialSecurity), true),
      cell(money(sum.medicare), true),
      cell(money(sum.stateIncome), true),
    );
    rows.append(total);
    body.append(wideTable(t));
  }
  body.append(
    note(
      "For checking the W-2s the payroll service files. Gross wages are before any pre-tax deduction: boxes 1, 3 and 5 " +
        "are the gross less 401(k) and other pre-tax deductions, which the service's own W-2 preview shows.",
    ),
  );
}

export function renderUsPayroll(): void {
  const body = $("uspayroll-body");
  body.textContent = "";
  fileSection(body);
  if (loaded !== null) {
    columnsSection(body, loaded.read);
    const days = registerPaydays(loaded.read);
    if (days.length === 0) {
      body.append(note("No paydays read: choose the column with the check date, and the columns with the amounts."));
    } else {
      accountsSection(body, payAccountsUsed(days));
      paydaysSection(body, days);
    }
  }
  inBooksSection(body);
}
