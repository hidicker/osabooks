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
  assert.equal(journal.id, "payroll-register-2026-01-15");
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
