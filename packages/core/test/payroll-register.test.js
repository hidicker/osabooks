import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPayAccounts,
  guessRole,
  payAccountsUsed,
  payrollRegisterJournal,
  payrollService,
  readPayrollRegister,
  registerPaydays,
  w2Figures,
} from "../dist/index.js";

// Laid out as a payroll journal report usually is: a title, section labels
// over the columns, then one row for each employee on each payday and a total.
const REGISTER = [
  "Payroll Journal,Cedar Ridge Landscaping Inc.,,,,,,,,,,,,,",
  ",,,,Employee taxes,,,,Deductions,,Employer taxes,,,,",
  "Employee,Check date,Pay period,Gross earnings,Federal Income Tax,Social Security,Medicare,OR Withholding Tax,401(k),Net pay,Social Security,Medicare,FUTA,OR SUTA,Employer taxes",
  'Dana Brooks,01/15/2026,01/01/2026 - 01/15/2026,"$3,500.00",$412.00,$217.00,$50.75,$268.00,$175.00,"$2,377.25",$217.00,$50.75,$21.00,$84.00,$372.75',
  'Luis Ortega,01/15/2026,01/01/2026 - 01/15/2026,"$2,800.00",$296.00,$173.60,$40.60,$205.00,$0.00,"$2,084.80",$173.60,$40.60,$16.80,$67.20,$298.20',
  'Dana Brooks,01/31/2026,01/16/2026 - 01/31/2026,"$3,500.00",$412.00,$217.00,$50.75,$268.00,$175.00,"$2,377.25",$217.00,$50.75,$21.00,$84.00,$372.75',
  'Total,,,"$9,800.00",,,,,,,,,,,',
].join("\r\n");

test("headings are read for what they hold, the second Social Security as the employer's", () => {
  const read = readPayrollRegister(REGISTER);
  assert.ok(read);
  assert.equal(read.headerLine, 3);
  assert.deepEqual(
    read.columns.map((c) => c.role),
    [
      "employee", "date", "skip", "gross", "federal", "socialEmployee", "medicareEmployee", "stateIncome",
      "deduction", "net", "socialEmployer", "medicareEmployer", "futa", "stateUnemployment", "skip",
    ],
  );
});

test("headings that say their side need no section", () => {
  assert.equal(guessRole("Employer Social Security"), "socialEmployer");
  assert.equal(guessRole("Employee Medicare"), "medicareEmployee");
  assert.equal(guessRole("Social Security (ER)"), "socialEmployer");
  assert.equal(guessRole("Additional Medicare"), "medicareEmployee");
  assert.equal(guessRole("CA SDI"), "otherEmployee");
  assert.equal(guessRole("Company 401(k) match"), "contribution");
  assert.equal(guessRole("Reimbursements"), "reimbursement");
  assert.equal(guessRole("Hours"), "skip");
  assert.equal(guessRole("Pay date"), "date");
});

test("a section total is used when the file has no breakdown", () => {
  const read = readPayrollRegister(
    "Employee,Check Date,Gross Pay,Employee Taxes,Net Pay,Employer Taxes\r\nAmy Li,2026-03-13,1000.00,150.00,850.00,80.00\r\n",
  );
  assert.deepEqual(read.columns.map((c) => c.role), ["employee", "date", "gross", "otherEmployee", "net", "otherEmployer"]);
  assert.equal(registerPaydays(read)[0].outBy, 0);
});

test("paydays add up, and the total row is left out", () => {
  const days = registerPaydays(readPayrollRegister(REGISTER));
  assert.deepEqual(days.map((d) => [d.date, d.pays.length, d.outBy]), [["2026-01-15", 2, 0], ["2026-01-31", 1, 0]]);
  assert.equal(days[0].totals.gross, 630_000);
  assert.equal(days[0].totals.net, 446_205);
  assert.equal(days[0].totals.futa, 3_780);
});

const CHART = [
  ["6180", "Wages", "Expense"],
  ["6310", "Payroll taxes", "Expense"],
  ["2100", "Wages payable", "Current Liability"],
  ["2110", "Federal income tax withheld", "Current Liability"],
  ["2120", "Social Security payable", "Current Liability"],
  ["2130", "Medicare payable", "Current Liability"],
  ["2140", "Federal unemployment (FUTA) payable", "Current Liability"],
  ["2150", "Oregon withholding payable", "Current Liability"],
  ["2160", "Oregon unemployment payable", "Current Liability"],
  ["2170", "401(k) deductions payable", "Current Liability"],
].map(([code, name, type]) => ({ code, name, type, taxCode: "", description: "" }));

test("each part finds its account by name", () => {
  const found = findPayAccounts(CHART);
  assert.equal(found.wages.code, "6180");
  assert.equal(found.netPay.code, "2100");
  assert.equal(found.federal.code, "2110");
  assert.equal(found.stateIncome.code, "2150");
  assert.equal(found.stateUnemployment.code, "2160");
  assert.equal(found.futa.code, "2140");
  assert.equal(found.deductions.code, "2170");
  assert.equal(found.benefits, undefined);
});

test("a payday posts as a balanced journal, a line for each employee's wages and withholding", () => {
  const days = registerPaydays(readPayrollRegister(REGISTER));
  const found = findPayAccounts(CHART);
  const accounts = Object.fromEntries(Object.entries(found).map(([k, a]) => [k, `${a.name} - ${a.code}`]));
  assert.deepEqual(payAccountsUsed(days).sort(), ["deductions", "employerTaxes", "federal", "futa", "medicare", "netPay", "socialSecurity", "stateIncome", "stateUnemployment", "wages"].sort());
  const journal = payrollRegisterJournal(days[0], accounts, "Gusto");
  assert.ok(journal);
  // The date, and a mark of who was paid what: two runs on one day are two journals.
  assert.match(journal.id, /^payroll-register-2026-01-15-[0-9a-f]+$/);
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  const line = (code) => journal.lines.filter((l) => l.code.endsWith(code)).reduce((s, l) => s + l.amount, 0);
  assert.equal(line("6180"), 630_000);
  assert.equal(line("6310"), 21_700 + 5_075 + 2_100 + 8_400 + 17_360 + 4_060 + 1_680 + 6_720);
  assert.equal(line("2120"), -(21_700 + 17_360) * 2);
  assert.equal(line("2100"), -446_205);
  assert.equal(journal.lines.find((l) => l.description === "Dana Brooks: gross wages").employee, "Dana Brooks");
  // An account not given: nothing posts.
  assert.equal(payrollRegisterJournal(days[0], { ...accounts, futa: undefined }), null);
});

test("a payday that does not add up is refused", () => {
  const read = readPayrollRegister("Employee,Check Date,Gross Pay,Federal Income Tax,Net Pay\r\nAmy Li,2026-03-13,1000.00,150.00,800.00\r\n");
  const [day] = registerPaydays(read);
  assert.equal(day.outBy, 5_000);
  assert.equal(payrollRegisterJournal(day, { wages: "W", federal: "F", netPay: "N" }), null);
});

test("the W-2 figures come back from the journals", () => {
  const days = registerPaydays(readPayrollRegister(REGISTER));
  const found = findPayAccounts(CHART);
  const accounts = Object.fromEntries(Object.entries(found).map(([k, a]) => [k, `${a.name} - ${a.code}`]));
  const journals = days.map((d) => payrollRegisterJournal(d, accounts, "Gusto"));
  const w2 = w2Figures(journals, 2026);
  assert.deepEqual(w2.map((e) => [e.employee, e.gross, e.federal, e.socialSecurity, e.medicare, e.stateIncome, e.paydays]), [
    ["Dana Brooks", 700_000, 82_400, 43_400, 10_150, 53_600, 2],
    ["Luis Ortega", 280_000, 29_600, 17_360, 4_060, 20_500, 1],
  ]);
  assert.deepEqual(w2Figures(journals, 2025), []);
});

test("the service is named from the file", () => {
  assert.equal(payrollService("gusto_payroll_journal_2026.csv"), "Gusto");
  assert.equal(payrollService("register.csv", "Paychex Flex Payroll Journal"), "Paychex");
  assert.equal(payrollService("register.csv"), "the payroll service");
});

const SIMPLE = (rows) =>
  ["Check Date,Employee,Gross Pay,Federal Income Tax,Social Security,Medicare,Net Pay", ...rows].join("\r\n");

test("a check and its void on the same day add nothing", () => {
  const days = registerPaydays(
    readPayrollRegister(
      SIMPLE([
        "01/15/2026,Pat Lee,1000.00,100.00,62.00,14.50,823.50",
        "01/15/2026,Pat Lee,-1000.00,-100.00,-62.00,-14.50,-823.50",
        "01/15/2026,Sam Cho,500.00,40.00,31.00,7.25,421.75",
      ]),
    ),
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].totals.gross, 50_000, "Sam's pay only");
  assert.equal(days[0].totals.net, 42_175);
  assert.equal(days[0].outBy, 0);
});

test("a void on a later day takes the check back, in the journal and the W-2 figures", () => {
  const days = registerPaydays(
    readPayrollRegister(
      SIMPLE([
        "01/15/2026,Pat Lee,1000.00,100.00,62.00,14.50,823.50",
        "01/31/2026,Pat Lee,-1000.00,-100.00,-62.00,-14.50,-823.50",
      ]),
    ),
  );
  assert.deepEqual(days.map((d) => [d.date, d.totals.gross]), [["2026-01-15", 100_000], ["2026-01-31", -100_000]]);
  const accounts = {
    wages: "Wages - 6000", federal: "Federal - 2110", socialSecurity: "SS - 2120", medicare: "Medicare - 2130",
    netPay: "Wages payable - 2100", employerTaxes: "Payroll taxes - 6010",
  };
  const journals = days.map((d) => payrollRegisterJournal(d, accounts));
  assert.ok(journals.every((j) => j !== null && j.lines.reduce((s, l) => s + l.amount, 0) === 0), "each balances");
  const wages = journals.flatMap((j) => j.lines).filter((l) => l.code === "Wages - 6000").reduce((s, l) => s + l.amount, 0);
  assert.equal(wages, 0, "wages back to nothing");
  const [pat] = w2Figures(journals, 2026);
  assert.deepEqual([pat.gross, pat.federal, pat.socialSecurity, pat.medicare], [0, 0, 0, 0]);
  assert.equal(pat.paydays, 0, "the void's day is not another payday");
});

test("an employee who was paid nothing that day reads the same in the register and the journal", async () => {
  const { paydayFingerprint, journalPaydayFingerprint } = await import("../dist/index.js");
  const day = {
    pays: [
      { employee: "Pat Lee", amounts: { gross: 100_000, net: 80_000 } },
      { employee: "Sam Cho", amounts: { gross: 0, net: 0, deduction: 5_000 } },
    ],
  };
  const journal = { lines: [
    { code: "W", amount: 100_000, employee: "Pat Lee", pay: "gross" },
    { code: "N", amount: -80_000, employee: "Pat Lee", pay: "net" },
  ] };
  assert.equal(paydayFingerprint(day), journalPaydayFingerprint(journal));
});

test("a service that lists withholding as negatives is read as amounts taken", () => {
  const days = registerPaydays(
    readPayrollRegister(
      SIMPLE([
        "01/15/2026,Pat Lee,1000.00,-100.00,-62.00,-14.50,823.50",
        "01/15/2026,Sam Cho,500.00,-40.00,-31.00,-7.25,421.75",
      ]),
    ),
  );
  assert.equal(days[0].totals.federal, 14_000);
  assert.equal(days[0].totals.socialEmployee, 9_300);
  assert.equal(days[0].outBy, 0);
});

test("a file of voids alone is read as checks taken back", () => {
  const days = registerPaydays(
    readPayrollRegister(
      SIMPLE([
        "01/31/2026,Pat Lee,-1000.00,-100.00,-62.00,-14.50,-823.50",
        "01/31/2026,Sam Cho,-500.00,-40.00,-31.00,-7.25,-421.75",
        "01/31/2026,Ana Ruiz,700.00,60.00,43.40,10.15,586.45",
      ]),
    ),
  );
  assert.equal(days[0].totals.gross, -80_000, "two checks of 1,500 taken back, one of 700 paid");
  assert.equal(days[0].totals.federal, -8_000);
  assert.equal(days[0].outBy, 0);
});

test("a void in a service that lists withholding as negatives comes back the other way", () => {
  const days = registerPaydays(
    readPayrollRegister(
      SIMPLE([
        "01/15/2026,Pat Lee,1000.00,-100.00,-62.00,-14.50,823.50",
        "01/15/2026,Sam Cho,-500.00,40.00,31.00,7.25,-421.75",
      ]),
    ),
  );
  assert.equal(days[0].totals.gross, 50_000);
  assert.equal(days[0].totals.federal, 6_000);
  assert.equal(days[0].outBy, 0);
});

test("a payday is the same as one in the books by who was paid what, not by its date alone", async () => {
  const { paydayFingerprint, journalPaydayFingerprint, payrollRegisterId } = await import("../dist/index.js");
  const read = (rows) => registerPaydays(readPayrollRegister(SIMPLE(rows)))[0];
  const regular = read(["01/15/2026,Pat Lee,1000.00,100.00,62.00,14.50,823.50", "01/15/2026,Sam Cho,500.00,40.00,31.00,7.25,421.75"]);
  const bonus = read(["01/15/2026,Pat Lee,2000.00,440.00,124.00,29.00,1407.00"]);
  const accounts = {
    wages: "Wages - 6000", federal: "Federal - 2110", socialSecurity: "SS - 2120", medicare: "Medicare - 2130",
    netPay: "Wages payable - 2100", employerTaxes: "Payroll taxes - 6010",
  };
  const posted = payrollRegisterJournal(regular, accounts);
  assert.equal(journalPaydayFingerprint(posted), paydayFingerprint(regular), "the regular run, once posted, reads as itself");
  assert.notEqual(paydayFingerprint(bonus), paydayFingerprint(regular), "a bonus run the same day is another payday");
  // Order of rows does not matter.
  const swapped = read(["01/15/2026,Sam Cho,500.00,40.00,31.00,7.25,421.75", "01/15/2026,Pat Lee,1000.00,100.00,62.00,14.50,823.50"]);
  assert.equal(paydayFingerprint(swapped), paydayFingerprint(regular));
  // Two paydays on one date get two ids.
  assert.notEqual(payrollRegisterId(regular.date, regular), payrollRegisterId(bonus.date, bonus));
  assert.match(payrollRegisterId(regular.date, regular), /^payroll-register-2026-01-15-[0-9a-f]+$/);
});

test("a reversed payroll journal, and its reversal, are no longer payroll standing in the books", async () => {
  const { standingJournals, reversalOf } = await import("../dist/index.js");
  const days = registerPaydays(readPayrollRegister(SIMPLE(["01/15/2026,Pat Lee,1000.00,100.00,62.00,14.50,823.50"])));
  const accounts = {
    wages: "Wages - 6000", federal: "Federal - 2110", socialSecurity: "SS - 2120", medicare: "Medicare - 2130",
    netPay: "Wages payable - 2100", employerTaxes: "Payroll taxes - 6010",
  };
  const posted = payrollRegisterJournal(days[0], accounts);
  const reversal = reversalOf(posted, "2026-01-20", "m1");
  const deleted = { ...payrollRegisterJournal(days[0], accounts), id: "gone", deleted: { at: "2026-01-21", by: "me" } };
  const other = { ...payrollRegisterJournal(days[0], accounts), id: "other" };
  const standing = standingJournals([posted, reversal, deleted, other]);
  assert.deepEqual(standing.map((j) => j.id), ["other"]);
  assert.equal(w2Figures(standing, 2026)[0].gross, 100_000, "the W-2 figures count the payroll still in the books, once");
  assert.equal(w2Figures([posted, reversal], 2026)[0].gross, 100_000, "read without it, the reversed one would still count");
});
