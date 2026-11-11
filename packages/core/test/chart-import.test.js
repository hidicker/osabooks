import assert from "node:assert/strict";
import test from "node:test";
import { applyChartPlan, chartImportPlan, parseHledgerAccounts, readChartFile } from "../dist/index.js";

const account = (code, name, type, over = {}) => ({ code, name, type, taxCode: "", description: "", ...over });

test("hledger's account directives and its account list", () => {
  const journal = [
    "; my books",
    "account Assets:Bank:Cheque    ; type: C",
    "account Expenses:Office supplies",
    "account Income:Sales",
    "commodity $1,000.00",
    "",
    "2026-05-01 Kowhai Fuels",
    "    Expenses:Auto:Fuel   $100",
    "    Assets:Bank:Cheque",
  ].join("\n");
  assert.deepEqual(parseHledgerAccounts(journal).map((a) => [a.name, a.type]), [
    ["Bank: Cheque", "Bank"],
    ["Office supplies", "Expense"],
    ["Sales", "Revenue"],
  ]);
  const listed = "Assets:Receivable  ; type: A\nLiabilities:GST  ; type: L\nEquity:Opening balances  ; type: E\n";
  assert.deepEqual(parseHledgerAccounts(listed).map((a) => [a.name, a.type]), [
    ["Receivable", "Current Asset"],
    ["GST", "Current Liability"],
    ["Opening balances", "Equity"],
  ]);
});

test("a spreadsheet with a code, a name and a type is read too", () => {
  const read = readChartFile("Account Code,Account Name,Account Type\n6100,Fuel,Expense\n4000,Sales,Revenue\n");
  assert.equal(read.read, "a spreadsheet of accounts");
  assert.deepEqual(read.accounts.map((a) => [a.code, a.name, a.type]), [["6100", "Fuel", "Expense"], ["4000", "Sales", "Revenue"]]);
  assert.equal(readChartFile("nothing,here\n1,2\n").accounts.length, 0);
});

test("the plan: new accounts added, matched ones changed in place, nothing taken out", () => {
  const current = [
    account("200", "Sales", "Revenue", { entity: "shop" }),
    account("429", "General", "Expense"),
    account("", "Cheque", "Bank", { ledgerAccount: "bnz-1" }),
  ];
  const incoming = [
    account("200", "Sales", "Revenue"),
    account("429", "General Expenses", "Overhead"),
    account("6100", "Fuel", "Expense"),
    account("", "cheque", ""),
  ];
  const plan = chartImportPlan(current, incoming);
  assert.deepEqual(plan.added.map((a) => a.code), ["6100"]);
  assert.deepEqual(plan.changed.map((c) => [c.before.name, c.after.name, c.after.type]), [["General", "General", "Overhead"]]);
  assert.deepEqual(plan.named.map((n) => [n.account.code, n.fileName]), [["429", "General Expenses"]], "named differently, not renamed");
  assert.equal(plan.same, 2);
  const after = applyChartPlan(current, plan);
  assert.equal(after.length, 4);
  assert.equal(after[0].entity, "shop", "what the file does not say is kept");
  assert.equal(after[2].ledgerAccount, "bnz-1");
});

test("a code the file gives to another account: renamed where nothing uses it, a clash where something does", () => {
  // Two charts numbered over the same range. 6100 is rent here and vehicles
  // in the file; 6110 is rent here, with lines coded to it, and wages there.
  const current = [
    account("4000", "Sales", "Revenue"),
    account("6100", "Rent or lease - equipment", "Expense"),
    account("6110", "Rent or lease - property", "Expense"),
    account("6400", "Office supplies", "Expense"),
  ];
  const incoming = [
    account("4000", "Service Income", "Revenue"),
    account("6100", "Auto & Truck Expense", "Overhead"),
    account("6110", "Wages & Salaries", "Expense"),
    account("6400", "Office Supplies & Software", "Expense"),
  ];
  const inUse = new Set(["6110"]);
  const plan = chartImportPlan(current, incoming, (a) => !inUse.has(a.code));
  assert.deepEqual(
    plan.renamed.map((r) => [r.before.code, r.after.name, r.after.type]),
    [["4000", "Service Income", "Revenue"], ["6100", "Auto & Truck Expense", "Overhead"]],
    "nothing uses them, so they are the file's accounts now",
  );
  assert.deepEqual(plan.clashes.map((c) => [c.account.code, c.fileName]), [["6110", "Wages & Salaries"]]);
  assert.deepEqual(plan.named.map((n) => n.account.code), ["6400"], "one account spelt two ways is not a clash");
  assert.deepEqual(plan.changed, [], "an account in use under another name keeps its type too");
  const after = applyChartPlan(current, plan);
  assert.deepEqual(after.map((a) => a.name), ["Service Income", "Auto & Truck Expense", "Rent or lease - property", "Office supplies"]);

  // With nothing said about use, nothing is renamed.
  const careful = chartImportPlan(current, incoming);
  assert.equal(careful.renamed.length, 0);
  assert.equal(careful.clashes.length, 3);
});
