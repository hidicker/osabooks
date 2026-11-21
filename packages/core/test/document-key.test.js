import assert from "node:assert/strict";
import test from "node:test";
import {
  agedReport,
  allocationProblem,
  classSource,
  DocumentIndex,
  documentKey,
  invoiceAssignments,
  invoiceBalances,
  jobProfits,
  matchInvoices,
  nextInvoiceNumber,
  postInvoice,
  postLedger,
  profitAndLossByClass,
  settlesInDirection,
} from "../dist/index.js";

// A move from Xero: the business's own sale INV-0012, and a supplier who also
// uses Xero sending their bill numbered INV-0012 too.
const doc = (kind, number, total, extra = {}) => ({
  number, kind, contact: kind === "sales" ? "Customer A" : "Supplier B", reference: "", issued: "2026-04-01",
  due: null, total, tax: 0, paid: 0, outstanding: 0, currency: "NZD", status: "",
  lines: [{ description: "", accountCode: kind === "sales" ? "200" : "400", taxType: "No GST", net: total, tax: 0, gross: total }],
  ...extra,
});
const sale = doc("sales", "INV-0012", 100_000);
const bill = doc("purchase", "INV-0012", 25_000);
const line = (id, amount, extra = {}) => ({
  id, date: "2026-04-10", account: "bank", amount, otherParty: "", particulars: "", code: "", reference: "",
  currency: "NZD", source: { importer: "test", file: "t.csv", line: 1 }, ...extra,
});

test("a sale and a bill sharing a number keep a balance each", () => {
  const balances = invoiceBalances([sale, bill], [{ document: documentKey(bill), amount: -25_000 }]);
  assert.equal(balances.size, 2, "both documents are there");
  assert.equal(balances.get("sales:INV-0012").remaining, 100_000, "the sale is still owed in full");
  assert.equal(balances.get("purchase:INV-0012").remaining, 0, "the bill is paid");
});

test("a bare number in older books is the document the money's direction settles", () => {
  // Books saved before keys hold "INV-0012" for both matches.
  const balances = invoiceBalances([sale, bill], [
    { document: "INV-0012", amount: 40_000 },
    { document: "INV-0012", amount: -25_000 },
  ]);
  assert.equal(balances.get("sales:INV-0012").remaining, 60_000, "the receipt part-pays the sale");
  assert.equal(balances.get("purchase:INV-0012").remaining, 0, "the payment pays the bill");
});

test("a bare number that cannot be told apart settles nothing, rather than the wrong one", () => {
  // Two sales of one number cannot exist, but a sale and a supplier's credit
  // note of one number both take money in.
  const credit = doc("purchase", "INV-0012", -5_000);
  const index = new DocumentIndex([sale, credit]);
  assert.equal(index.resolve("INV-0012", (d) => settlesInDirection(d, 5_000)), undefined);
  assert.equal(index.resolve("sales:INV-0012")?.kind, "sales", "a key always says which");
});

test("the direction money settles a document in", () => {
  assert.equal(settlesInDirection(sale, 1), true, "a receipt pays a sale");
  assert.equal(settlesInDirection(bill, -1), true, "a payment pays a bill");
  assert.equal(settlesInDirection(bill, 1), false);
  assert.equal(settlesInDirection(doc("sales", "CN-1", -1_000), -1), true, "a refund of a customer's credit note goes out");
  assert.equal(settlesInDirection(doc("purchase", "SCN-1", -1_000), 1), true, "a supplier's refund comes in");
});

test("each payment posts to its own document's control account", () => {
  const receipt = line("r1", 100_000);
  const payment = line("p1", -25_000);
  const journals = postLedger({
    transactions: [receipt, payment],
    codeOf: () => "",
    classify: () => ({ treatment: "exempt", side: "sales" }),
    chart: [
      { code: "090", name: "Bank", type: "Bank", taxCode: "No GST", description: "" },
      { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
      { code: "800", name: "Accounts Payable", type: "Current Liability", taxCode: "No GST", description: "" },
    ],
    bankLabels: new Map(),
    byId: new Map([["r1", receipt], ["p1", payment]]),
    invoices: [sale, bill],
    // One as a key, one as a bare number from older books: both find their own.
    settled: new Map([["r1", "sales:INV-0012"], ["p1", "INV-0012"]]),
    transfers: {},
    manualJournals: [],
  });
  const of = (id) => journals.find((j) => j.transactionId === id).lines.map((l) => [l.accountCode, l.amount]);
  assert.ok(of("r1").some(([code, amount]) => code === "610" && amount === -100_000), "the receipt clears receivables");
  assert.ok(!of("r1").some(([code]) => code === "800"), "and not payables");
  assert.ok(of("p1").some(([code, amount]) => code === "800" && amount === 25_000), "the payment clears payables");
});

test("the matcher looks for money in against sales only", () => {
  // A paid Xero bill of 250 and a customer's receipt of 250 two days later:
  // paired, the receipt posted to Accounts Payable.
  const paidBill = doc("purchase", "B-1", 25_000, { paid: 25_000 });
  const found = matchInvoices({ invoices: [paidBill], transactions: [line("r1", 25_000)] });
  assert.equal(found.matched.length, 0);
  assert.deepEqual(found.unmatched.map((i) => i.number), ["B-1"], "the bill is still listed");
  assert.equal(found.proposals.length, 0);

  const paidSale = doc("sales", "INV-1", 25_000, { paid: 25_000 });
  const both = matchInvoices({ invoices: [paidBill, paidSale], transactions: [line("r1", 25_000)] });
  assert.deepEqual(both.matched.map((m) => m.invoice.kind), ["sales"]);
});

test("what a person accepted comes out as a key, whatever older books stored", () => {
  const map = invoiceAssignments({
    invoices: [sale, bill],
    transactions: [line("r1", 100_000), line("p1", -25_000), line("x", 5_000)],
    accepted: { r1: "INV-0012", p1: "purchase:INV-0012", x: "" },
    splits: {},
  });
  assert.equal(map.get("r1"), "sales:INV-0012");
  assert.equal(map.get("p1"), "purchase:INV-0012");
  assert.equal(map.has("x"), false, "a refusal is not an assignment");
});

test("the next invoice number counts only the business's own sales", () => {
  // A supplier's bill numbered A1234567 made the next sale INV-1234568.
  const docs = [doc("sales", "INV-0012", 1), doc("purchase", "A1234567", 1), doc("purchase", "INV-0950", 1)];
  assert.equal(nextInvoiceNumber("sales", docs), "INV-0013");
  assert.equal(nextInvoiceNumber("purchase", [doc("purchase", "BILL-0004", 1), doc("sales", "BILL-0900", 1)]), "BILL-0005");
  assert.equal(nextInvoiceNumber("purchase", docs), "BILL-0001", "a supplier's own numbers are not this series");
  assert.equal(nextInvoiceNumber("sales", [doc("sales", "0041", 1)]), "INV-0042", "a sale still carries on from the business's own");
});

test("aged receivables are not reduced by the payment of a bill of the same number", () => {
  const report = agedReport({
    invoices: [sale, bill],
    kind: "sales",
    payments: [{ document: "purchase:INV-0012", date: "2026-04-10", amount: -25_000 }],
    asAt: "2026-04-30",
  });
  assert.equal(report.total, 100_000);
});

test("credit is used within one kind: a customer's credit never pays a supplier's bill", () => {
  const credit = doc("sales", "CN-1", -10_000, { contact: "Customer A" });
  const balances = invoiceBalances([sale, bill, credit], []);
  assert.equal(allocationProblem([{ from: "sales:CN-1", to: "sales:INV-0012", amount: 10_000, date: "2026-04-02" }], balances), null);
  assert.notEqual(allocationProblem([{ from: "sales:CN-1", to: "purchase:INV-0012", amount: 10_000, date: "2026-04-02" }], balances), null);
});

test("a job given the sale does not take the bill of the same number", () => {
  const journals = [postInvoice(sale, {}), postInvoice(bill, {})];
  assert.equal(classSource(journals[0]), "sales:INV-0012");
  assert.equal(classSource(journals[1]), "purchase:INV-0012");
  const held = { jobs: [{ id: "j1", name: "Deck", customer: "Customer A" }], assigned: { "sales:INV-0012": "j1" } };
  const side = (code) => (code === "200" ? "income" : code === "400" ? "cost" : null);
  const [deck] = jobProfits(journals, held, side);
  assert.equal(deck.income, 100_000);
  assert.equal(deck.costs, 0, "the supplier's bill is not the job's cost");

  // A class given under a bare number before keys still counts, as it did.
  const counts = (code) => code === "200" || code === "400";
  const columns = profitAndLossByClass(journals, { "INV-0012": "Shop" }, counts, { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(columns.map((c) => c.name), ["Shop"]);
});
