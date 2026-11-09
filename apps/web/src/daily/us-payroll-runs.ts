import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import { save } from "../store.js";
import { askOnPage, note, wideTable } from "../ui.js";
import { settleAccounts } from "./us-payroll-accounts.js";
import {
  US_PERIODS,
  US_STATE_PAYROLL,
  grossBefore,
  localToday,
  parseAmount,
  payAccountsUsed,
  stateWithholdingWorked,
  suiWageBase,
  usNextPeriod,
  usPayLine,
  usPayRunAsPayday,
  usTablesCurrent,
} from "@nzosa/core";
import type {
  CaDe4,
  IsoDate,
  UsEmployee,
  UsEmployer,
  UsFilingStatus,
  UsPayEntered,
  UsPayFrequency,
  UsPayLine,
  UsPayRun,
  UsPayroll,
} from "@nzosa/core";

/**
 * Pay runs for United States books: the employer's state, the employees and
 * their W-4s, and each pay run's withholding, worked out and open to change.
 */

const money = (cents: number): string => booksMoney(cents);
const amount = (text: string): number | null => (text.trim() === "" ? 0 : parseAmount(text, "USD"));

const STATES: readonly [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const FREQUENCIES: readonly [UsPayFrequency, string][] = [
  ["weekly", "Weekly"],
  ["biweekly", "Every two weeks"],
  ["semimonthly", "Twice a month"],
  ["monthly", "Monthly"],
];

const STATUSES: readonly [UsFilingStatus, string][] = [
  ["single", "Single or married filing separately"],
  ["married", "Married filing jointly"],
  ["head", "Head of household"],
];

export function heldUsPayroll(): UsPayroll | undefined {
  return state.ledger.usPayroll;
}

async function keep(next: UsPayroll, what: string): Promise<void> {
  const before = state.ledger.usPayroll ?? null;
  state.ledger = { ...state.ledger, usPayroll: next };
  state.persistent = await save(state.ledger);
  await record("uspayroll", what, before, next);
  redraw("uspayroll");
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function field(labelText: string, control: HTMLElement, hint = ""): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "account-add-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  if (hint !== "") {
    const small = document.createElement("small");
    small.className = "field-hint";
    small.textContent = hint;
    label.append(small);
  }
  return label;
}

function input(value = "", placeholder = "", type = "text"): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function select<T extends string>(options: readonly [T, string][], value: T | "", blank?: string): HTMLSelectElement {
  const el = document.createElement("select");
  if (blank !== undefined) el.append(Object.assign(document.createElement("option"), { value: "", textContent: blank }));
  for (const [v, text] of options) el.append(Object.assign(document.createElement("option"), { value: v, textContent: text }));
  el.value = value;
  return el;
}

function checkbox(text: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] {
  const label = document.createElement("label");
  label.className = "checkbox";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  label.append(box, ` ${text}`);
  return [label, box];
}

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

const centsText = (cents: number | undefined): string => (cents === undefined || cents === 0 ? "" : (cents / 100).toFixed(2));

function stateName(code: string): string {
  return STATES.find(([c]) => c === code)?.[1] ?? code;
}

// --- the employer ----------------------------------------------------------------

function employerSection(body: HTMLElement, payroll: UsPayroll | undefined): void {
  body.append(heading("Employer"));
  const employer: UsEmployer = payroll?.employer ?? { state: "" };
  const where = select(STATES, employer.state as string, "Choose the state");
  where.setAttribute("aria-label", "The employer's state");
  const rules = US_STATE_PAYROLL[employer.state];
  const rate = input(employer.suiRate === undefined ? "" : String(employer.suiRate), rules?.newEmployerRate === undefined ? "e.g. 2.7" : String(rules.newEmployerRate));
  const base = input(centsText(employer.suiWageBase), rules?.suiWageBase === undefined ? "e.g. 9,000.00" : (rules.suiWageBase / 100).toFixed(2));
  const futa = input(employer.futaRate === undefined ? "" : String(employer.futaRate), "0.6");
  const grid = document.createElement("div");
  grid.className = "agent-fields";
  grid.append(
    field("State", where, "Where the employees work. Each employee can be given another."),
    field("State unemployment rate (%)", rate, "The rate on the state's notice to you; a new employer's rate until then."),
    field(
      "Unemployment wage base",
      base,
      rules?.suiWageBase === undefined ? "Each employee's pay taxed each year, as the state sets it." : "Leave blank for the state's.",
    ),
    field("FUTA rate (%)", futa, "0.6 unless the state is a credit reduction state."),
  );
  const said = document.createElement("p");
  said.className = "feed-said";
  const saveIt = button(
    payroll === undefined ? "Start payroll" : "Save",
    () => {
      if (where.value === "") {
        said.textContent = "Choose the state.";
        return;
      }
      const suiRate = rate.value.trim() === "" ? undefined : Number(rate.value);
      const futaRate = futa.value.trim() === "" ? undefined : Number(futa.value);
      const wageBase = base.value.trim() === "" ? undefined : parseAmount(base.value, "USD");
      if ((suiRate !== undefined && !Number.isFinite(suiRate)) || (futaRate !== undefined && !Number.isFinite(futaRate)) || wageBase === null) {
        said.textContent = "A rate or the wage base is not a number.";
        return;
      }
      const next: UsEmployer = {
        state: where.value,
        ...(suiRate !== undefined ? { suiRate } : {}),
        ...(wageBase !== undefined ? { suiWageBase: wageBase } : {}),
        ...(futaRate !== undefined ? { futaRate } : {}),
        ...(employer.ettRate !== undefined ? { ettRate: employer.ettRate } : {}),
      };
      void keep({ employees: [], payRuns: [], ...payroll, employer: next }, "Payroll employer settings");
    },
    true,
  );
  body.append(grid, saveIt, said);
  if (payroll !== undefined) {
    const code = payroll.employer.state;
    const worked = stateWithholdingWorked(code);
    body.append(
      note(
        worked
          ? US_STATE_PAYROLL[code]?.income === "none"
            ? `${stateName(code)} has no income tax on wages: each pay run works out the federal taxes and ${stateName(code)}'s unemployment tax.`
            : `${stateName(code)}'s withholding is worked out from each employee's DE 4, with SDI, UI and ETT.`
          : `${stateName(code)}'s income tax withholding is not worked out here yet: give it on each pay run, from the state's tables or calculator.`,
      ),
    );
  }
}

// --- employees -------------------------------------------------------------------

/** The form for a new employee, or to change one. */
function employeeForm(payroll: UsPayroll, editing?: UsEmployee): HTMLElement {
  const wrap = document.createElement("details");
  wrap.className = "payroll-add";
  wrap.open = editing !== undefined;
  const summary = document.createElement("summary");
  summary.textContent = editing === undefined ? "Add an employee" : `Change ${editing.name}`;
  wrap.append(summary);
  const w4 = editing?.w4 ?? { status: "single" as const };
  const name = input(editing?.name ?? "", "Their name");
  const frequency = select(FREQUENCIES, editing?.payFrequency ?? "biweekly");
  const usual = input(centsText(editing?.usualGross), "e.g. 2,400.00");
  const status = select(STATUSES, w4.status);
  const [step2Label, step2] = checkbox("Step 2: two jobs, or a spouse who works (box checked)", w4.step2 === true);
  const dependents = input(centsText(w4.dependents), "0.00");
  const other = input(centsText(w4.otherIncome), "0.00");
  const deductions = input(centsText(w4.deductions), "0.00");
  const extra = input(centsText(w4.extra), "0.00");
  const allowances = input(w4.allowances === undefined ? "" : String(w4.allowances), "Only for a W-4 from before 2020");
  const [exemptLabel, exempt] = checkbox("Claims exemption from federal withholding", w4.exempt === true);
  const where = select(STATES, (editing?.state ?? "") as string, `The employer's (${stateName(payroll.employer.state)})`);
  const de4 = editing?.de4;
  const caStatus = select(STATUSES, de4?.status ?? w4.status);
  const caAllowances = input(de4 === undefined ? "1" : String(de4.allowances));
  const caEstimated = input(de4?.estimated === undefined ? "" : String(de4.estimated), "0");
  const caExtra = input(centsText(de4?.extra), "0.00");
  const routing = input(editing?.routing ?? "", "9 digits");
  const account = input(editing?.account ?? "", "Account number");
  const accountType = select<"checking" | "savings">([["checking", "Checking"], ["savings", "Savings"]], editing?.accountType ?? "checking");
  const ended = input(editing?.ended ?? "", "", "date");

  const grid = document.createElement("div");
  grid.className = "agent-fields";
  grid.append(
    field("Name", name),
    field("Paid", frequency),
    field("Usual gross pay", usual, "Each pay run starts with it; change it there for the pay."),
    field("Works in", where),
  );
  const w4Grid = document.createElement("div");
  w4Grid.className = "agent-fields";
  w4Grid.append(
    field("W-4 Step 1(c) filing status", status),
    field("Step 3: credits for dependents, a year", dependents),
    field("Step 4(a): other income, a year", other),
    field("Step 4(b): deductions, a year", deductions),
    field("Step 4(c): extra withholding each paycheck", extra),
    field("Allowances", allowances, "A W-4 from before 2020 only: the steps above are then not used."),
  );
  const caGrid = document.createElement("div");
  caGrid.className = "agent-fields";
  caGrid.append(
    field("DE 4 filing status", caStatus),
    field("Regular withholding allowances", caAllowances),
    field("Allowances for estimated deductions", caEstimated),
    field("Extra California withholding each paycheck", caExtra),
  );
  const caBox = document.createElement("div");
  caBox.append(heading("California DE 4"), caGrid);
  const showCa = (): void => {
    caBox.hidden = (where.value || payroll.employer.state) !== "CA";
  };
  where.addEventListener("change", showCa);
  showCa();
  const bankGrid = document.createElement("div");
  bankGrid.className = "agent-fields";
  bankGrid.append(field("Routing number", routing), field("Account number", account), field("Account type", accountType));
  if (editing !== undefined) bankGrid.append(field("Last day worked", ended, "Left off pay runs after it."));

  const said = document.createElement("p");
  said.className = "feed-said";
  const done = button(
    editing === undefined ? "Add employee" : "Save employee",
    () => {
      const who = name.value.trim();
      if (who === "") {
        said.textContent = "Give the employee's name.";
        return;
      }
      const money4 = [usual, dependents, other, deductions, extra, caExtra].map((i) => amount(i.value));
      if (money4.some((v) => v === null)) {
        said.textContent = "An amount is not a number.";
        return;
      }
      const [gross, dep, oth, ded, ext, caExt] = money4 as number[];
      const allowed = allowances.value.trim() === "" ? undefined : Number(allowances.value);
      const caAllowed = Number(caAllowances.value || "0");
      const caEst = Number(caEstimated.value || "0");
      if ((allowed !== undefined && !Number.isInteger(allowed)) || !Number.isInteger(caAllowed) || !Number.isInteger(caEst)) {
        said.textContent = "Allowances are whole numbers.";
        return;
      }
      if (routing.value.trim() !== "" && !/^\d{9}$/.test(routing.value.trim())) {
        said.textContent = "A routing number is nine digits.";
        return;
      }
      const state2 = where.value;
      const caDe4: CaDe4 | undefined =
        (state2 || payroll.employer.state) === "CA"
          ? {
              status: caStatus.value as UsFilingStatus,
              allowances: caAllowed,
              ...(caEst > 0 ? { estimated: caEst } : {}),
              ...(caExt! > 0 ? { extra: caExt! } : {}),
            }
          : undefined;
      const employee: UsEmployee = {
        id: editing?.id ?? `emp-${Date.now().toString(36)}`,
        name: who,
        payFrequency: frequency.value as UsPayFrequency,
        ...(gross! > 0 ? { usualGross: gross! } : {}),
        w4: {
          status: status.value as UsFilingStatus,
          ...(step2.checked ? { step2: true } : {}),
          ...(dep! > 0 ? { dependents: dep! } : {}),
          ...(oth! > 0 ? { otherIncome: oth! } : {}),
          ...(ded! > 0 ? { deductions: ded! } : {}),
          ...(ext! > 0 ? { extra: ext! } : {}),
          ...(allowed !== undefined ? { allowances: allowed } : {}),
          ...(exempt.checked ? { exempt: true } : {}),
        },
        ...(state2 !== "" ? { state: state2 } : {}),
        ...(caDe4 !== undefined ? { de4: caDe4 } : {}),
        ...(routing.value.trim() !== "" ? { routing: routing.value.trim() } : {}),
        ...(account.value.trim() !== "" ? { account: account.value.trim(), accountType: accountType.value as "checking" | "savings" } : {}),
        ...(ended.value !== "" ? { ended: ended.value } : {}),
      };
      const employees = editing === undefined ? [...payroll.employees, employee] : payroll.employees.map((e) => (e.id === editing.id ? employee : e));
      editingId = undefined;
      void keep({ ...payroll, employees }, `${editing === undefined ? "Employee added" : "Employee changed"}: ${who}`);
    },
    true,
  );
  const w4Box = document.createElement("div");
  w4Box.append(heading("Form W-4"), w4Grid, step2Label, exemptLabel);
  const bankBox = document.createElement("div");
  bankBox.append(heading("Direct deposit"), bankGrid);
  wrap.append(grid, w4Box, caBox, bankBox, done, said);
  return wrap;
}

let editingId: string | undefined;

function employeesSection(body: HTMLElement, payroll: UsPayroll): void {
  body.append(heading("Employees"));
  if (payroll.employees.length > 0) {
    const t = document.createElement("table");
    t.className = "report-table";
    t.innerHTML = "<thead><tr><th>Name</th><th>Paid</th><th>Usual gross</th><th>W-4</th><th>Works in</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const e of payroll.employees) {
      const tr = document.createElement("tr");
      const cells = [
        e.name + (e.ended !== undefined ? ` (left ${e.ended})` : ""),
        FREQUENCIES.find(([f]) => f === e.payFrequency)?.[1] ?? e.payFrequency,
        e.usualGross === undefined ? "" : money(e.usualGross),
        e.w4.exempt === true ? "Exempt" : (STATUSES.find(([s]) => s === e.w4.status)?.[1] ?? "") + (e.w4.step2 === true ? ", Step 2" : ""),
        stateName(e.state ?? payroll.employer.state),
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.append(td);
      }
      const act = document.createElement("td");
      const change = button("Change", () => {
        editingId = e.id;
        redraw("uspayroll");
      });
      change.className = "link-button";
      act.append(change);
      tr.append(act);
      tb.append(tr);
    }
    t.append(tb);
    body.append(wideTable(t));
  }
  const editing = payroll.employees.find((e) => e.id === editingId);
  body.append(employeeForm(payroll, editing));
  if (editing !== undefined) body.append(employeeForm(payroll));
}

// --- a new pay run -----------------------------------------------------------------

function usualFrequency(employees: readonly UsEmployee[]): UsPayFrequency {
  const counts = new Map<UsPayFrequency, number>();
  for (const e of employees) counts.set(e.payFrequency, (counts.get(e.payFrequency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "biweekly";
}

function firstPeriod(frequency: UsPayFrequency): { periodStart: IsoDate; periodEnd: IsoDate; payDate: IsoDate } {
  const today = localToday();
  // Twice a month and monthly follow the calendar: the 1st to the 15th, the 16th to the month's end.
  if (frequency === "semimonthly" || frequency === "monthly") {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const first = Number(today.slice(8, 10)) <= 15 && frequency === "semimonthly";
    const periodStart = frequency === "monthly" ? `${today.slice(0, 8)}01` : first ? `${today.slice(0, 8)}01` : `${today.slice(0, 8)}16`;
    const periodEnd = first ? `${today.slice(0, 8)}15` : monthEnd;
    return { periodStart, periodEnd, payDate: periodEnd };
  }
  const days = Math.round(365 / US_PERIODS[frequency]);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return { periodStart: d.toISOString().slice(0, 10), periodEnd: today, payDate: today };
}

function newPayRun(body: HTMLElement, payroll: UsPayroll): void {
  body.append(heading("New pay run"));
  const active = payroll.employees.filter((e) => e.ended === undefined);
  if (active.length === 0) {
    body.append(note("Add an employee first."));
    return;
  }
  const last = [...payroll.payRuns].sort((a, b) => b.payDate.localeCompare(a.payDate))[0];
  const frequency = usualFrequency(active);
  const dates = last === undefined ? firstPeriod(frequency) : usNextPeriod(last, frequency);
  const start = input(dates.periodStart, "", "date");
  const end = input(dates.periodEnd, "", "date");
  const pay = input(dates.payDate, "", "date");
  const grid = document.createElement("div");
  grid.className = "agent-fields";
  grid.append(field("Period from", start), field("Period to", end), field("Pay date", pay));
  body.append(grid);

  // For each employee: gross, and the federal and state withholding, each
  // worked out until changed.
  const rows = active.map((employee) => {
    const gross = input(centsText(employee.usualGross), "0.00");
    const federal = input("", "");
    const stateIncome = input("", "");
    const touched = { federal: false, stateIncome: false };
    federal.addEventListener("input", () => (touched.federal = true));
    stateIncome.addEventListener("input", () => (touched.stateIncome = true));
    const out = document.createElement("td");
    out.className = "report-amount";
    const net = document.createElement("td");
    net.className = "report-amount";
    return { employee, gross, federal, stateIncome, touched, out, net, line: null as UsPayLine | null };
  });
  const said = document.createElement("p");
  said.className = "feed-said";

  const work = (): void => {
    for (const r of rows) {
      const gross = amount(r.gross.value);
      if (gross === null) {
        r.line = null;
        r.net.textContent = "?";
        continue;
      }
      const before = grossBefore(payroll.payRuns, r.employee.id, pay.value || localToday());
      const entered: UsPayEntered = {};
      if (r.touched.federal) {
        const v = amount(r.federal.value);
        if (v !== null) entered.federal = v;
      }
      const code = (r.employee.state ?? payroll.employer.state).toUpperCase();
      if (r.touched.stateIncome || !stateWithholdingWorked(code)) {
        const v = amount(r.stateIncome.value);
        if (v !== null) entered.stateIncome = v;
      }
      const line = usPayLine(r.employee, gross, pay.value || localToday(), before, payroll.employer, entered);
      r.line = line;
      if (!r.touched.federal) r.federal.value = (line.federal / 100).toFixed(2);
      if (!r.touched.stateIncome && stateWithholdingWorked(code)) r.stateIncome.value = (line.stateIncome / 100).toFixed(2);
      r.out.textContent = money(line.socialSecurity + line.medicare + line.stateOther);
      r.net.textContent = money(line.net);
    }
    const when = pay.value || localToday();
    said.textContent = usTablesCurrent(when) ? "" : `Worked with 2026's tables: ${when.slice(0, 4)}'s are not held here. Check each figure.`;
  };

  const t = document.createElement("table");
  t.className = "report-table";
  t.innerHTML =
    "<thead><tr><th>Employee</th><th>Gross pay</th><th>Federal income tax</th><th>State income tax</th>" +
    "<th class=\"report-amount\">Social Security, Medicare and state</th><th class=\"report-amount\">Net pay</th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = r.employee.name;
    r.gross.setAttribute("aria-label", `Gross pay for ${r.employee.name}`);
    r.federal.setAttribute("aria-label", `Federal income tax for ${r.employee.name}`);
    r.stateIncome.setAttribute("aria-label", `State income tax for ${r.employee.name}`);
    const code = (r.employee.state ?? payroll.employer.state).toUpperCase();
    if (US_STATE_PAYROLL[code]?.income === "none") r.stateIncome.disabled = true;
    const cells = [r.gross, r.federal, r.stateIncome].map((i) => {
      const td = document.createElement("td");
      i.inputMode = "decimal";
      i.className = "split-amount";
      i.addEventListener("input", work);
      td.append(i);
      return td;
    });
    tr.append(nameCell, ...cells, r.out, r.net);
    tb.append(tr);
  }
  t.append(tb);
  pay.addEventListener("change", work);
  body.append(wideTable(t));
  work();

  const unworked = [...new Set(active.map((e) => (e.state ?? payroll.employer.state).toUpperCase()))].filter((s) => !stateWithholdingWorked(s));
  if (unworked.length > 0) {
    body.append(note(`${unworked.map(stateName).join(" and ")}: give the state income tax to withhold for each paycheck.`));
  }

  const saveRun = button(
    "Save pay run",
    () => {
      work();
      if (!start.value || !end.value || !pay.value) {
        said.textContent = "Give the period and the pay date.";
        return;
      }
      if (end.value < start.value) {
        said.textContent = "The period ends before it starts.";
        return;
      }
      const lines = rows.map((r) => r.line).filter((l): l is UsPayLine => l !== null && l.gross > 0);
      if (rows.some((r) => r.line === null)) {
        said.textContent = "A gross pay is not a number.";
        return;
      }
      if (lines.length === 0) {
        said.textContent = "Nobody is paid on this run.";
        return;
      }
      if (lines.some((l) => l.net < 0)) {
        said.textContent = "A paycheck's withholding is more than its gross.";
        return;
      }
      const run: UsPayRun = { id: `run-${Date.now().toString(36)}`, payDate: pay.value, periodStart: start.value, periodEnd: end.value, lines };
      const nameOf = (id: string) => payroll.employees.find((e) => e.id === id)?.name ?? id;
      const used = payAccountsUsed([usPayRunAsPayday(run, nameOf)]);
      const accounts = { ...settleAccounts(used.filter((a) => payroll.accounts?.[a] === undefined)), ...payroll.accounts };
      void keep({ ...payroll, accounts, payRuns: [...payroll.payRuns, run] }, `Pay run, paid ${run.payDate}`);
    },
    true,
  );
  body.append(saveRun, said);
}

// --- the pay runs --------------------------------------------------------------------

function payRunsSection(body: HTMLElement, payroll: UsPayroll): void {
  body.append(heading("Pay runs"));
  if (payroll.payRuns.length === 0) {
    body.append(note("No pay runs yet."));
    return;
  }
  const t = document.createElement("table");
  t.className = "report-table";
  t.innerHTML =
    "<thead><tr><th>Pay date</th><th>Period</th><th>Employees</th><th class=\"report-amount\">Gross</th>" +
    "<th class=\"report-amount\">Withheld</th><th class=\"report-amount\">Net pay</th>" +
    "<th class=\"report-amount\">Employer taxes</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  const runs = [...payroll.payRuns].sort((a, b) => b.payDate.localeCompare(a.payDate));
  for (const run of runs) {
    const sum = (pick: (l: UsPayLine) => number): number => run.lines.reduce((s, l) => s + pick(l), 0);
    const tr = document.createElement("tr");
    const values: [string, boolean][] = [
      [run.payDate, false],
      [`${run.periodStart} to ${run.periodEnd}`, false],
      [String(run.lines.length), false],
      [money(sum((l) => l.gross)), true],
      [money(sum((l) => l.federal + l.socialSecurity + l.medicare + l.stateIncome + l.stateOther)), true],
      [money(sum((l) => l.net)), true],
      [money(sum((l) => l.employerSocialSecurity + l.employerMedicare + l.futa + l.stateUnemployment + l.stateOtherEmployer)), true],
    ];
    for (const [text, right] of values) {
      const td = document.createElement("td");
      td.textContent = text;
      if (right) td.className = "report-amount";
      tr.append(td);
    }
    const act = document.createElement("td");
    const drop = button("Delete", () => {
      void askOnPage(`Delete the pay run paid ${run.payDate}? Its journal comes out of the books. History can bring it back.`, "Delete").then((yes) => {
        if (yes) void keep({ ...payroll, payRuns: payroll.payRuns.filter((r) => r.id !== run.id) }, `Pay run deleted, paid ${run.payDate}`);
      });
    });
    drop.className = "link-button";
    act.append(drop);
    tr.append(act);
    tb.append(tr);
  }
  t.append(tb);
  body.append(wideTable(t));
  const base = suiWageBase(payroll.employer.state, payroll.employer);
  body.append(
    note(
      "Each pay run posts gross wages and the employer's taxes as costs, and the net pay and each tax as owed: pay " +
        "them from the bank and code those lines to the same accounts. Deposit the federal taxes by EFTPS and file Form 941 " +
        "each quarter; the Form 941 worksheet on Reports reads these runs." +
        (base === undefined ? " Give the state's unemployment wage base above to work out its tax." : ""),
    ),
  );
}

/** The pay run part of the US Payroll page. */
export function usPayRunSections(body: HTMLElement): void {
  const payroll = heldUsPayroll();
  employerSection(body, payroll);
  if (payroll === undefined) return;
  employeesSection(body, payroll);
  newPayRun(body, payroll);
  payRunsSection(body, payroll);
}
