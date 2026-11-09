/**
 * A US payroll service's payroll register, read into the books.
 *
 * In the United States a small business rarely works out its own payroll: a
 * service (Gusto, ADP, Paychex) calculates each payday's withholding, files the
 * 941s and W-2s and pulls the taxes from the bank. What the books need is each
 * payday's totals, posted where the Form 941 worksheet reads them. The service's
 * register (Gusto calls it the payroll journal report) has them, one row for
 * each employee on each payday.
 *
 * The columns are each service's own, and Gusto lets each account choose its
 * columns, so nothing here expects a fixed layout. Each heading is read for what
 * it holds (`guessRole`) and the person importing can change any guess. Every
 * payday must then add up: gross pay and reimbursements, less the employee's
 * taxes and deductions, is the net pay. A payday that does not is refused, as an
 * unbalanced manual journal is, rather than posted with a difference.
 *
 * Gross wages, the taxes withheld from them and the net pay are kept a line for
 * each employee, marked with the employee's name, so the W-2 figures can be
 * read back from the books (`w2Figures`). The employer's taxes, deductions and
 * contributions are one line each.
 */
import type { Account } from "./chart.js";
import { parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import type { ManualJournal, ManualJournalLine } from "./manual-journals.js";
import { parseAmount } from "./money.js";
import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/** What an amount column holds. */
export type PayAmount =
  | "gross"
  | "reimbursement"
  | "federal"
  | "socialEmployee"
  | "medicareEmployee"
  | "stateIncome"
  | "otherEmployee"
  | "deduction"
  | "net"
  | "socialEmployer"
  | "medicareEmployer"
  | "futa"
  | "stateUnemployment"
  | "otherEmployer"
  | "contribution";

/** What a column of the register holds. */
export type RegisterRole = PayAmount | "skip" | "date" | "employee" | "firstName" | "lastName";

export const PAY_AMOUNTS: readonly PayAmount[] = [
  "gross",
  "reimbursement",
  "federal",
  "socialEmployee",
  "medicareEmployee",
  "stateIncome",
  "otherEmployee",
  "deduction",
  "net",
  "socialEmployer",
  "medicareEmployer",
  "futa",
  "stateUnemployment",
  "otherEmployer",
  "contribution",
];

/** Each role as the import screen names it. */
export const REGISTER_ROLE_LABELS: Record<RegisterRole, string> = {
  skip: "Not used",
  date: "Check date",
  employee: "Employee name",
  firstName: "First name",
  lastName: "Last name",
  gross: "Gross pay",
  reimbursement: "Reimbursement (paid with net pay)",
  federal: "Federal income tax withheld",
  socialEmployee: "Social Security, employee",
  medicareEmployee: "Medicare, employee",
  stateIncome: "State income tax withheld",
  otherEmployee: "Other employee tax (local, SDI, family leave)",
  deduction: "Employee deduction (401(k), health)",
  net: "Net pay",
  socialEmployer: "Social Security, employer",
  medicareEmployer: "Medicare, employer",
  futa: "FUTA, employer",
  stateUnemployment: "State unemployment (SUTA), employer",
  otherEmployer: "Other employer tax",
  contribution: "Employer contribution (401(k) match, health)",
};

const EMPLOYEE_TAXES: readonly PayAmount[] = ["federal", "socialEmployee", "medicareEmployee", "stateIncome", "otherEmployee"];
const EMPLOYER_TAXES: readonly PayAmount[] = ["socialEmployer", "medicareEmployer", "futa", "stateUnemployment", "otherEmployer"];

export interface RegisterColumn {
  index: number;
  heading: string;
  role: RegisterRole;
}

export interface RegisterRow {
  /** 1-based line in the file. */
  line: number;
  fields: readonly string[];
}

export interface RegisterRead {
  /** 1-based line of the column headings. */
  headerLine: number;
  columns: RegisterColumn[];
  rows: RegisterRow[];
}

type Side = "employee" | "employer" | undefined;

/**
 * The side a heading's money is on, from the heading or the section above it:
 * Gusto and others group taxes under "Employee taxes" and "Employer taxes".
 */
function sideOf(text: string): Side {
  if (/\bemployer\b|\bcompany\b|\ber\b|\bmatch/i.test(text)) return "employer";
  if (/\bemployee\b|\bee\b|withh/i.test(text)) return "employee";
  return undefined;
}

/**
 * What a column holds, read from its heading and the section it sits under.
 * `side` is the side a bare "Social Security" or "Medicare" heading takes when
 * neither says: the first is the employee's, a second the employer's.
 */
export function guessRole(heading: string, section = "", side?: "employee" | "employer"): RegisterRole {
  const h = heading.trim().toLowerCase();
  const said = sideOf(heading) ?? sideOf(section) ?? side;
  if (h === "") return "skip";
  if (/check ?date|pay ?date|payday|payment date|date paid|paid on/.test(h)) return "date";
  if (/^first ?name$|employee first/.test(h)) return "firstName";
  if (/^last ?name$|employee last|surname/.test(h)) return "lastName";
  if (/^(employee( name)?|name|employee full name|full name|worker|team member)$/.test(h)) return "employee";
  // Counts and descriptions, and section totals (when a breakdown sits beside
  // them, counting both would take the tax twice).
  if (/hours|\brate\b|\bid\b|ssn|number|department|title|location|method|type|period|status|memo/.test(h)) return "skip";
  if (/^(total )?(employee|employer|company) (taxes|deductions|contributions|benefits)( total)?$/.test(h)) return "skip";
  if (/total (employer )?cost|total cost|employer cost/.test(h)) return "skip";
  if (/reimburse/.test(h)) return "reimbursement";
  if (/^net( pay| wages| amount)?$|take.?home|net pay/.test(h)) return "net";
  if (/gross|total earnings|total wages|total pay$/.test(h)) return "gross";
  if (/futa|federal unemployment/.test(h)) return "futa";
  if (/suta|\bsui\b|state unemployment|unemployment/.test(h)) return "stateUnemployment";
  if (/federal (income )?(tax )?(withh|income)|federal withholding|\bfit\b|^federal( tax)?$/.test(h)) return "federal";
  if (/social security|oasdi|\bss\b/.test(h)) return said === "employer" ? "socialEmployer" : "socialEmployee";
  if (/medicare/.test(h)) return said === "employer" ? "medicareEmployer" : "medicareEmployee";
  if (/contribution|match/.test(h)) return "contribution";
  if (/401|403|retire|\bira\b|health|dental|vision|medical|\bhsa\b|\bfsa\b|insurance|garnish|child support|deduction|loan|union|dues|benefit/.test(h)) {
    return said === "employer" ? "contribution" : "deduction";
  }
  if (/\bsdi\b|\bpfl\b|\bpfml\b|family leave|disability|local|city|county|school|workers.?comp|\bwc\b|transit|\bett\b/.test(h)) {
    return said === "employer" ? "otherEmployer" : "otherEmployee";
  }
  if (/state|withholding|income tax|\bsit\b|\b[a-z]{2} (state )?(income )?(tax|withholding)\b/.test(h)) {
    return said === "employer" ? "otherEmployer" : "stateIncome";
  }
  if (/tax/.test(h)) return said === "employer" ? "otherEmployer" : "otherEmployee";
  return "skip";
}

/** The row holding the headings: one with a date column and a gross or net column. */
function headerIndex(records: readonly RegisterRow[]): number {
  const limit = Math.min(records.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const roles = (records[i]?.fields ?? []).map((f) => guessRole(f));
    if (roles.includes("date") && (roles.includes("gross") || roles.includes("net"))) return i;
  }
  return -1;
}

/**
 * Read a payroll register's headings and rows. Null when no row has both a
 * check date and a gross or net pay heading.
 */
export function readPayrollRegister(text: string): RegisterRead | null {
  const records: RegisterRow[] = parseCsvRecords(text).map((r) => ({ line: r.line, fields: r.fields }));
  const at = headerIndex(records);
  if (at < 0) return null;
  const header = records[at]?.fields ?? [];
  // A section row above the headings ("Employee taxes", "Employer taxes"),
  // its label spread right until the next one, as a merged cell is.
  const above = at > 0 ? (records[at - 1]?.fields ?? []) : [];
  const sections: string[] = [];
  let current = "";
  for (let i = 0; i < header.length; i += 1) {
    const cell = above[i]?.trim() ?? "";
    if (cell !== "") current = cell;
    sections.push(current);
  }
  const seen = new Map<string, number>();
  const columns: RegisterColumn[] = header.map((heading, index) => {
    const first = guessRole(heading, sections[index] ?? "");
    // A bare "Social Security" or "Medicare" seen a second time is the employer's.
    const key = first === "socialEmployee" || first === "medicareEmployee" ? first : "";
    let role = first;
    if (key !== "" && sideOf(heading) === undefined && sideOf(sections[index] ?? "") === undefined) {
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      if (count > 0) role = guessRole(heading, "", "employer");
    }
    return { index, heading, role };
  });
  // A section total stands in for its breakdown when the file has none.
  const has = (roles: readonly RegisterRole[]) => columns.some((c) => roles.includes(c.role));
  for (const column of columns) {
    if (column.role !== "skip") continue;
    const h = column.heading.trim().toLowerCase();
    if (!/^(total )?(employee|employer|company) (taxes|deductions|contributions|benefits)( total)?$/.test(h)) continue;
    const employer = /employer|company/.test(h);
    if (/taxes/.test(h)) {
      if (!has(employer ? EMPLOYER_TAXES : EMPLOYEE_TAXES)) column.role = employer ? "otherEmployer" : "otherEmployee";
    } else if (!has([employer ? "contribution" : "deduction"])) column.role = employer ? "contribution" : "deduction";
  }
  // Only one date and one name column: the first wins, the rest are not used.
  for (const single of ["date", "employee", "firstName", "lastName", "gross", "net"] as const) {
    let found = false;
    for (const column of columns) {
      if (column.role !== single) continue;
      if (found) column.role = "skip";
      found = true;
    }
  }
  return { headerLine: records[at]?.line ?? 1, columns, rows: records.slice(at + 1) };
}

/** One employee's pay on one payday. */
export interface RegisterPay {
  employee: string;
  amounts: Record<PayAmount, Cents>;
}

/** One payday, every employee paid on it. */
export interface RegisterPayday {
  date: IsoDate;
  pays: RegisterPay[];
  totals: Record<PayAmount, Cents>;
  /** Gross and reimbursements less taxes, deductions and net pay: 0 when it adds up. */
  outBy: Cents;
  /** File lines that could not be read, with why. */
  problems: string[];
}

const zero = (): Record<PayAmount, Cents> => Object.fromEntries(PAY_AMOUNTS.map((a) => [a, 0])) as Record<PayAmount, Cents>;

/** Gross and reimbursements, less the employee's taxes and deductions, less net pay. */
export function payOutBy(amounts: Record<PayAmount, Cents>): Cents {
  const taken = EMPLOYEE_TAXES.reduce((s, a) => s + amounts[a], 0) + amounts.deduction;
  return amounts.gross + amounts.reimbursement - taken - amounts.net;
}

/** The employer's taxes on a payday's or an employee's pay. */
export function employerTaxes(amounts: Record<PayAmount, Cents>): Cents {
  return EMPLOYER_TAXES.reduce((s, a) => s + amounts[a], 0);
}

/** The employee's taxes withheld. */
export function employeeTaxes(amounts: Record<PayAmount, Cents>): Cents {
  return EMPLOYEE_TAXES.reduce((s, a) => s + amounts[a], 0);
}

/**
 * The register's rows gathered by check date. A row with no date, or whose
 * name says it is a total, is left out; so is a row with no money in it.
 * Amounts are read as positive whichever way the service signs them, since a
 * register lists withholding as amounts taken, not as negatives to add.
 */
export function registerPaydays(read: RegisterRead): RegisterPayday[] {
  const role = (r: RegisterRole) => read.columns.filter((c) => c.role === r);
  const dateColumn = role("date")[0];
  if (dateColumn === undefined) return [];
  const nameOf = (fields: readonly string[]): string => {
    const whole = role("employee")[0];
    if (whole !== undefined) return (fields[whole.index] ?? "").trim();
    const first = role("firstName")[0];
    const last = role("lastName")[0];
    return [first, last].map((c) => (c === undefined ? "" : (fields[c.index] ?? "").trim())).filter((s) => s !== "").join(" ");
  };
  const byDate = new Map<IsoDate, RegisterPayday>();
  for (const row of read.rows) {
    const name = nameOf(row.fields);
    const dateText = (row.fields[dateColumn.index] ?? "").trim();
    if (/total/i.test(name) || /total/i.test(dateText)) continue;
    const date = parseDate(dateText, { dayFirst: false });
    if (date === null) continue;
    const amounts = zero();
    let any = false;
    const problems: string[] = [];
    for (const column of read.columns) {
      if (!(PAY_AMOUNTS as readonly string[]).includes(column.role)) continue;
      const text = (row.fields[column.index] ?? "").trim();
      if (text === "" || text === "-") continue;
      const cents = parseAmount(text.replace(/^\$|(?<=-)\$/g, ""), "USD");
      if (cents === null) {
        problems.push(`Line ${row.line}: "${text}" under ${column.heading} is not an amount.`);
        continue;
      }
      if (cents !== 0) any = true;
      amounts[column.role as PayAmount] += Math.abs(cents);
    }
    if (!any && problems.length === 0) continue;
    const day = byDate.get(date) ?? { date, pays: [], totals: zero(), outBy: 0, problems: [] };
    day.problems.push(...problems);
    const employee = name === "" ? `Line ${row.line}` : name;
    const same = day.pays.find((p) => p.employee === employee);
    if (same === undefined) day.pays.push({ employee, amounts });
    else for (const a of PAY_AMOUNTS) same.amounts[a] += amounts[a];
    for (const a of PAY_AMOUNTS) day.totals[a] += amounts[a];
    byDate.set(date, day);
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) day.outBy = payOutBy(day.totals);
  return days;
}

/** Where each part of a payday posts. */
export type PayAccount =
  | "wages"
  | "reimbursements"
  | "employerTaxes"
  | "benefits"
  | "netPay"
  | "federal"
  | "socialSecurity"
  | "medicare"
  | "futa"
  | "stateIncome"
  | "stateUnemployment"
  | "otherTaxes"
  | "deductions";

/** Each account as the import names it, its type, and the amounts that post to it. */
export const PAY_ACCOUNTS: readonly { id: PayAccount; name: string; type: string; from: readonly PayAmount[] }[] = [
  { id: "wages", name: "Wages", type: "Expense", from: ["gross"] },
  { id: "reimbursements", name: "Employee reimbursements", type: "Expense", from: ["reimbursement"] },
  { id: "employerTaxes", name: "Payroll taxes", type: "Expense", from: EMPLOYER_TAXES },
  { id: "benefits", name: "Employee benefits", type: "Expense", from: ["contribution"] },
  { id: "netPay", name: "Wages payable", type: "Current Liability", from: ["net"] },
  { id: "federal", name: "Federal income tax withheld", type: "Current Liability", from: ["federal"] },
  { id: "socialSecurity", name: "Social Security payable", type: "Current Liability", from: ["socialEmployee", "socialEmployer"] },
  { id: "medicare", name: "Medicare payable", type: "Current Liability", from: ["medicareEmployee", "medicareEmployer"] },
  { id: "futa", name: "Federal unemployment (FUTA) payable", type: "Current Liability", from: ["futa"] },
  { id: "stateIncome", name: "State income tax withheld", type: "Current Liability", from: ["stateIncome"] },
  { id: "stateUnemployment", name: "State unemployment (SUTA) payable", type: "Current Liability", from: ["stateUnemployment"] },
  { id: "otherTaxes", name: "Other payroll taxes payable", type: "Current Liability", from: ["otherEmployee", "otherEmployer"] },
  { id: "deductions", name: "Payroll deductions payable", type: "Current Liability", from: ["deduction", "contribution"] },
];

const ACCOUNT_NAMES: Record<PayAccount, { expense: boolean; pattern: RegExp; not?: RegExp }> = {
  wages: { expense: true, pattern: /\b(wages?|salar(y|ies)|payroll expenses?)\b/i, not: /payable|tax|benefit|reimburse/i },
  reimbursements: { expense: true, pattern: /reimburse/i },
  employerTaxes: { expense: true, pattern: /payroll tax|employer tax|employment tax/i },
  benefits: { expense: true, pattern: /benefit|health insurance|retirement (plan|contrib)|401/i },
  netPay: { expense: false, pattern: /wages payable|net (pay|wages)|salar(y|ies) payable|payroll clearing/i },
  federal: { expense: false, pattern: /federal (income )?(tax )?withh|\bfit\b|federal income tax/i },
  socialSecurity: { expense: false, pattern: /social security|oasdi/i },
  medicare: { expense: false, pattern: /medicare/i },
  futa: { expense: false, pattern: /futa|federal unemployment/i },
  stateIncome: { expense: false, pattern: /withh|state income tax/i, not: /federal|\bfit\b/i },
  stateUnemployment: { expense: false, pattern: /suta|\bsui\b|unemployment/i, not: /federal|futa/i },
  otherTaxes: { expense: false, pattern: /other payroll tax|payroll taxes? payable|local tax|\bsdi\b/i },
  deductions: { expense: false, pattern: /deductions? payable|401|retirement payable|benefits payable|garnish/i },
};

/**
 * The chart's account for each part of a payday, found by name as the Form 941
 * worksheet finds them: an expense for the costs, a liability for what is owed.
 * Undefined where the chart has none.
 */
export function findPayAccounts(chart: readonly Account[]): Partial<Record<PayAccount, Account>> {
  const out: Partial<Record<PayAccount, Account>> = {};
  for (const { id } of PAY_ACCOUNTS) {
    const rule = ACCOUNT_NAMES[id];
    const found = chart.find((a) => {
      const expense = /expense|overhead|direct/i.test(a.type);
      const liability = /liab/i.test(a.type);
      if (rule.expense ? !expense : !liability) return false;
      if (rule.not?.test(a.name) === true) return false;
      return rule.pattern.test(a.name);
    });
    if (found !== undefined) out[id] = found;
  }
  return out;
}

/** The accounts a set of paydays posts to: those with money on some payday. */
export function payAccountsUsed(days: readonly RegisterPayday[]): PayAccount[] {
  return PAY_ACCOUNTS.filter(({ from }) => days.some((d) => from.some((a) => d.totals[a] !== 0))).map((a) => a.id);
}

/** The id a payday's journal is kept under, so importing the same register again finds it. */
export function payrollRegisterId(date: IsoDate): string {
  return `payroll-register-${date}`;
}

const EMPLOYEE_LINES: readonly [PayAmount, PayAccount, string, 1 | -1][] = [
  ["gross", "wages", "gross wages", 1],
  ["federal", "federal", "federal income tax withheld", -1],
  ["socialEmployee", "socialSecurity", "Social Security withheld", -1],
  ["medicareEmployee", "medicare", "Medicare withheld", -1],
  ["stateIncome", "stateIncome", "state income tax withheld", -1],
  ["net", "netPay", "net pay", -1],
];

const TOTAL_LINES: readonly [PayAmount, PayAccount, string, 1 | -1][] = [
  ["reimbursement", "reimbursements", "Reimbursements paid with net pay", 1],
  ["contribution", "benefits", "Employer contributions", 1],
  ["socialEmployer", "socialSecurity", "Social Security, employer", -1],
  ["medicareEmployer", "medicare", "Medicare, employer", -1],
  ["futa", "futa", "FUTA", -1],
  ["stateUnemployment", "stateUnemployment", "State unemployment (SUTA)", -1],
  ["otherEmployee", "otherTaxes", "Other taxes withheld", -1],
  ["otherEmployer", "otherTaxes", "Other employer taxes", -1],
  ["deduction", "deductions", "Employee deductions", -1],
  ["contribution", "deductions", "Employer contributions owed", -1],
];

/**
 * A payday as a manual journal, or null when it does not add up or an account
 * it needs is not given. `accounts` gives each account as a journal line writes
 * it (`Wages - 6180`). `service` names where the register came from.
 */
export function payrollRegisterJournal(
  day: RegisterPayday,
  accounts: Partial<Record<PayAccount, string>>,
  service = "the payroll service",
): ManualJournal | null {
  if (day.outBy !== 0 || day.problems.length > 0) return null;
  const lines: ManualJournalLine[] = [];
  const add = (account: PayAccount, amount: Cents, description: string, extra: Partial<ManualJournalLine> = {}): boolean => {
    if (amount === 0) return true;
    const code = accounts[account];
    if (code === undefined || code === "") return false;
    lines.push({ code, amount, description, ...extra });
    return true;
  };
  for (const pay of day.pays) {
    for (const [amount, account, words, sign] of EMPLOYEE_LINES) {
      if (!add(account, sign * pay.amounts[amount], `${pay.employee}: ${words}`, { employee: pay.employee, pay: amount })) return null;
    }
  }
  const taxCost = employerTaxes(day.totals);
  if (!add("employerTaxes", taxCost, "Employer payroll taxes")) return null;
  for (const [amount, account, words, sign] of TOTAL_LINES) {
    if (!add(account, sign * day.totals[amount], words, { pay: amount })) return null;
  }
  if (lines.reduce((s, l) => s + l.amount, 0) !== 0) return null;
  const people = day.pays.length;
  return {
    id: payrollRegisterId(day.date),
    date: day.date,
    narration: `Payroll paid ${day.date}, ${people} ${people === 1 ? "employee" : "employees"}, from ${service}'s payroll register`,
    source: `${service} payroll register`,
    lines,
  };
}

/** The payroll service a file most likely came from, by its name or contents. */
export function payrollService(fileName: string, text = ""): string {
  const both = `${fileName} ${text.slice(0, 4000)}`;
  if (/gusto/i.test(both)) return "Gusto";
  if (/\badp\b|run powered by adp/i.test(both)) return "ADP";
  if (/paychex/i.test(both)) return "Paychex";
  if (/quickbooks|intuit/i.test(both)) return "QuickBooks Payroll";
  if (/rippling/i.test(both)) return "Rippling";
  if (/onpay/i.test(both)) return "OnPay";
  return "the payroll service";
}

/** One employee's year, as the W-2 boxes take it. */
export interface W2Figures {
  employee: string;
  /** Gross wages before any pre-tax deduction. */
  gross: Cents;
  federal: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  stateIncome: Cents;
  paydays: number;
}

/**
 * Each employee's year from the payroll journals in the books: the lines
 * marked with an employee's name. For checking the W-2s the payroll service
 * files, not for filing: boxes 1, 3 and 5 are the gross less any pre-tax
 * deductions, which the register's own W-2 preview gives.
 */
export function w2Figures(journals: readonly ManualJournal[], year: number): W2Figures[] {
  const by = new Map<string, W2Figures & { days: Set<string> }>();
  for (const journal of journals) {
    if (journal.deleted !== undefined || !journal.date.startsWith(`${year}-`)) continue;
    for (const line of journal.lines) {
      if (line.employee === undefined || line.pay === undefined) continue;
      const one = by.get(line.employee) ?? {
        employee: line.employee,
        gross: 0,
        federal: 0,
        socialSecurity: 0,
        medicare: 0,
        stateIncome: 0,
        paydays: 0,
        days: new Set<string>(),
      };
      const amount = Math.abs(line.amount);
      if (line.pay === "gross") one.gross += amount;
      else if (line.pay === "federal") one.federal += amount;
      else if (line.pay === "socialEmployee") one.socialSecurity += amount;
      else if (line.pay === "medicareEmployee") one.medicare += amount;
      else if (line.pay === "stateIncome") one.stateIncome += amount;
      one.days.add(journal.date);
      by.set(line.employee, one);
    }
  }
  return [...by.values()]
    .map(({ days, ...rest }) => ({ ...rest, paydays: days.size }))
    .sort((a, b) => a.employee.localeCompare(b.employee));
}
