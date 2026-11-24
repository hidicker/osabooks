import assert from "node:assert/strict";
import test from "node:test";
import {
  documentsInPlay,
  historicalAccountIn,
  identifyExport,
  invoiceBalances,
  isAgedDetail,
  openingDocumentJournals,
  openingDocumentsTotal,
  owingAtStart,
  postLedger,
  readAgedDetail,
} from "../dist/index.js";

// Laid out as Xero's Aged Receivables Detail: the contact on a row of its
// own, its invoices under it with the first column empty, the amount owing in
// Total (the sum of the ageing columns).
const RECEIVABLES = [
  "Aged Receivables Detail,,,,,,,,,,,,",
  "Kowhai Trading Limited,,,,,,,,,,,,",
  "As at 31 March 2025,,,,,,,,,,,,",
  "Ageing by due date,,,,,,,,,,,,",
  "Contact Account Number,Primary Person,Invoice Date,Due Date,Invoice Number,Invoice Reference,Current,< 1 Month,1 Month,Older,Total,Outstanding GST,Invoice Seen",
  "Rimu Cafe,,,,,,,,,,,,",
  ",,2025-02-04,2025-04-22,INV-0012,,300.00,0,0,0,300.00,39.13,Not seen",
  ",,2025-03-01,2025-04-20,INV-0014,,0,0,0,0,0.00,0,Not seen",
  "Total Rimu Cafe,,,,,,300.00,0,0,0,300.00,39.13,",
  "Totara Supplies,,,,,,,,,,,,",
  ",,2025-01-10,2025-02-10,INV-0009,,0,0,125.50,0,125.50,16.37,Seen",
  "Total Totara Supplies,,,,,,0,0,125.50,0,125.50,16.37,",
  "Total,,,,,,300.00,0,125.50,0,425.50,55.50,",
  "Percentage of total,,,,,,70%,0%,30%,0%,100%,,",
].join("\n");

const invoice = (number, issued, total, kind = "sales") => ({
  number, kind, contact: "Rimu Cafe", reference: "", issued, due: issued,
  total, tax: 0, paid: 0, outstanding: total, currency: "NZD", status: "Awaiting Payment",
  lines: [{ description: "Work", accountCode: "200", taxType: "No GST", gross: total, tax: 0, net: total }],
});

test("recognises the report and reads the open documents", () => {
  assert.ok(isAgedDetail(RECEIVABLES));
  assert.equal(identifyExport(RECEIVABLES).kind, "aged-detail");
  const { record } = readAgedDetail(RECEIVABLES);
  assert.equal(record.kind, "sales");
  assert.equal(record.asAt, "2025-03-31");
  assert.deepEqual(
    record.items.map((i) => [i.number, i.contact, i.owing]),
    [["INV-0012", "Rimu Cafe", 30000], ["INV-0009", "Totara Supplies", 12550]],
    "a line owing nothing is not open, and total rows are not documents",
  );
  assert.equal(openingDocumentsTotal(record), 42550);
});

test("the payables report is bills", () => {
  const payables = RECEIVABLES.replace("Aged Receivables Detail", "Aged Payables Detail")
    .replace("Invoice Number", "Bill Number").replace("Invoice Date", "Bill Date");
  const { record } = readAgedDetail(payables);
  assert.equal(record.kind, "purchase");
  assert.equal(record.items.length, 2);
});

// Laid out as Xero's Aged Payables Detail really is: the column is "Invoice
// Reference", left empty on every bill, and each bill's date stands in the
// first column where a receivable's row has nothing.
const PAYABLES = [
  "Aged Payables Detail,,,,,,,,,",
  "Kowhai Trading Limited,,,,,,,,,",
  "As at 31 March 2025,,,,,,,,,",
  "Ageing by due date,,,,,,,,,",
  "Invoice Date,Due Date,Invoice Reference,Current,< 1 Month,1 Month,2 Months,3 Months,Older,Total",
  "Rimu Supplies,,,,,,,,,",
  "2024-08-26,2025-06-19,,6.80,0,0,0,0,0,6.80",
  "Total Rimu Supplies,,,0,0,0,0,0,0,0",
  "Totara Hosting,,,,,,,,,",
  "2024-08-20,2025-06-19,,100.00,0,0,0,0,0,100.00",
  "2024-09-02,2025-06-19,,4.99,0,0,0,0,0,4.99",
  "Total Totara Hosting,,,0,0,0,0,0,0,0",
  "Total,,,0,0,0,0,0,0,0",
  "Percentage of total,,,0,0,0,0,0,0,0",
].join("\n");

test("bills with no reference, their date in the first column, are each read", () => {
  // Read by the number column alone, every one of these was taken for a payee
  // and the report said it had no invoice number column.
  assert.equal(identifyExport(PAYABLES).kind, "aged-detail");
  const { record, problem } = readAgedDetail(PAYABLES);
  assert.equal(problem, undefined);
  assert.equal(record.kind, "purchase");
  assert.deepEqual(
    record.items.map((i) => [i.contact, i.owing, i.date]),
    [["Rimu Supplies", 680, "2024-08-26"], ["Totara Hosting", 10000, "2024-08-20"], ["Totara Hosting", 499, "2024-09-02"]],
  );
  assert.equal(new Set(record.items.map((i) => i.number)).size, 3, "each named, by payee and date");
});

test("before the start: open ones carried forward, the rest left out; from the start: all", () => {
  const { record } = readAgedDetail(RECEIVABLES);
  const invoices = [
    invoice("INV-0012", "2025-02-04", 50000), // part paid before the start: 300 still owing
    invoice("INV-0010", "2025-01-20", 20000), // paid before the start
    invoice("INV-0020", "2025-04-15", 11500), // in these books
    invoice("BILL-1", "2025-02-01", 9000, "purchase"), // no payables report: kept as it was
  ];
  const inPlay = documentsInPlay(invoices, "2025-04-01", [record]);
  assert.deepEqual(inPlay.map((i) => i.number), ["INV-0012", "INV-0020", "BILL-1"]);
  assert.equal(inPlay[0].broughtForward, 30000);
  assert.equal(inPlay[1].broughtForward, undefined);
  assert.equal(documentsInPlay(invoices, undefined, [record]).length, 4, "no start, nothing decided");
});

test("a carried-forward invoice owes what the report said, and its receipt clears it", () => {
  const { record } = readAgedDetail(RECEIVABLES);
  const [carried] = documentsInPlay([invoice("INV-0012", "2025-02-04", 50000)], "2025-04-01", [record]);
  const receipt = {
    id: "r1", date: "2025-04-20", account: "BNZ 01", amount: 30000, otherParty: "Rimu Cafe",
    particulars: "", code: "", reference: "INV-0012", description: "", currency: "NZD", source: "bank",
  };
  const balances = invoiceBalances([carried], [{ document: "INV-0012", amount: 30000 }]);
  assert.equal(balances.get("sales:INV-0012").remaining, 0, "paid in full, though the invoice was for more");

  const journals = postLedger({
    transactions: [receipt], codeOf: () => "200 Sales",
    classify: () => ({ treatment: "exempt", side: "sales" }),
    chart: [
      { code: "090", name: "BNZ 01", type: "Bank", taxCode: "No GST", description: "" },
      { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
      { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
    ],
    bankLabels: new Map(), byId: new Map([["r1", receipt]]),
    invoices: [carried], settled: new Map([["r1", "INV-0012"]]), transfers: {}, manualJournals: [],
    startDate: "2025-04-01",
  });
  const lines = journals.flatMap((j) => j.lines);
  assert.equal(lines.filter((l) => l.accountCode === "200").length, 0, "the sale was last year's: not posted again");
  assert.equal(
    lines.filter((l) => l.accountCode === "610").reduce((s, l) => s + l.amount, 0),
    -30000,
    "the receipt clears 300 of the opening receivable",
  );
});

test("an invoice dated before the start is not posted, one from the start is", () => {
  const fee = {
    id: "f1", date: "2025-04-02", account: "BNZ 01", amount: -500, otherParty: "Bank",
    particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank",
  };
  const journals = postLedger({
    transactions: [fee], codeOf: () => "404 Bank Fees", classify: () => ({ treatment: "exempt", side: "purchases" }),
    chart: [], bankLabels: new Map(), byId: new Map([["f1", fee]]),
    invoices: [invoice("INV-0010", "2025-03-20", 20000), invoice("INV-0020", "2025-04-01", 11500)],
    settled: new Map(), transfers: {}, manualJournals: [], startDate: "2025-04-01",
  });
  const text = JSON.stringify(journals);
  assert.match(text, /INV-0020/);
  assert.doesNotMatch(text, /INV-0010/);
});

// Made in these books: what it owed on the start day is known here.
const keyed = (number, issued, total, kind = "sales", extra = {}) => ({
  ...invoice(number, issued, total, kind), paid: 0, outstanding: total, enteredHere: true, ...extra,
});
const CHART = [
  { code: "090", name: "BNZ 01", type: "Bank", taxCode: "No GST", description: "" },
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
  { code: "800", name: "Accounts Payable", type: "Current Liability", taxCode: "No GST", description: "" },
  { code: "840", name: "Historical Adjustment", type: "Historical", taxCode: "No GST", description: "" },
  { code: "960", name: "Retained Earnings", type: "Retained Earnings", taxCode: "No GST", description: "" },
];
const postWith = (invoices, { transactions = [], settled = new Map(), openingFigures = {}, agedKinds = [] } = {}) =>
  postLedger({
    transactions, codeOf: () => "200 Sales", classify: () => ({ treatment: "exempt", side: "sales" }),
    chart: CHART, bankLabels: new Map(), byId: new Map(transactions.map((t) => [t.id, t])),
    invoices, settled, transfers: {}, manualJournals: [], startDate: "2025-04-01",
    owingAtStart: { historical: historicalAccountIn(CHART), openingFigures, agedKinds },
  });
const sumOf = (journals, code) => journals.flatMap((j) => j.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.amount, 0);

test("Xero's way: an invoice made here before the start opens the receivable, against Historical Adjustment", () => {
  const journals = postWith([keyed("INV-0005", "2025-03-10", 11500)]);
  assert.equal(sumOf(journals, "610"), 11500, "owing on the start day");
  assert.equal(sumOf(journals, "840"), -11500);
  assert.equal(sumOf(journals, "200"), 0, "the sale was last year's: not posted again");
  assert.equal(journals.find((j) => j.lines.some((l) => l.accountCode === "610")).date, "2025-04-01");
  // And its receipt after the start clears it.
  const receipt = {
    id: "r1", date: "2025-04-20", account: "BNZ 01", amount: 11500, otherParty: "Rimu Cafe",
    particulars: "", code: "", reference: "INV-0005", description: "", currency: "NZD", source: "bank",
  };
  const paid = postWith([keyed("INV-0005", "2025-03-10", 11500)], { transactions: [receipt], settled: new Map([["r1", "INV-0005"]]) });
  assert.equal(sumOf(paid, "610"), 0, "raised on the start day, cleared by the receipt");
});

test("what was paid before the start is not owing; a bill opens the payable; a credit note turns round", () => {
  const journals = postWith([
    keyed("INV-0006", "2025-03-01", 20000, "sales", { paidOutside: [{ date: "2025-03-15", amount: 5000, accountCode: "090" }] }),
    keyed("INV-0007", "2025-03-02", 8000, "sales", { paidOutside: [{ date: "2025-03-20", amount: 8000, accountCode: "090" }] }),
    keyed("BILL-9", "2025-03-05", 3000, "purchase"),
    keyed("CN-1", "2025-03-06", -1000),
  ]);
  assert.equal(sumOf(journals, "610"), 15000 - 1000, "150 still owing on INV-0006, nothing on INV-0007, less the credit");
  assert.equal(sumOf(journals, "800"), -3000, "a bill is a credit to payables");
  assert.equal(sumOf(journals, "840"), -(15000 - 1000) + 3000);
});

test("an opening figure as well is replaced by the documents, and the difference is said", () => {
  const journals = postWith([keyed("INV-0005", "2025-03-10", 11500)], { openingFigures: { "610": 500000 } });
  // Not 5,000 + 115: the documents are the opening receivable.
  assert.equal(500000 + sumOf(journals, "610"), 11500);
  assert.equal(sumOf(journals, "840"), 500000 - 11500, "what the figure and the documents differ by");
  const { accounts } = openingDocumentJournals(
    owingAtStart([keyed("INV-0005", "2025-03-10", 11500)], "2025-04-01", {
      controlOf: () => ({ code: "610", name: "Accounts Receivable" }), agedKinds: [],
    }),
    { start: "2025-04-01", historical: historicalAccountIn(CHART), openingFigures: { "610": 500000 } },
  );
  assert.deepEqual(accounts.map((a) => [a.control.code, a.documents, a.opening, a.difference]), [["610", 11500, 500000, 488500]]);
  // Where they agree, nothing is left over.
  const same = postWith([keyed("INV-0005", "2025-03-10", 11500)], { openingFigures: { "610": 11500 } });
  assert.equal(sumOf(same, "840"), 0);
  assert.equal(11500 + sumOf(same, "610"), 11500);
});

test("left as they were: imported documents, drafts, kinds with an aged list, and books without the option", () => {
  const imported = invoice("INV-0001", "2025-03-10", 11500); // no enteredHere: what it owed then is not known
  const draft = keyed("INV-0002", "2025-03-10", 2000, "sales", { status: "Draft" });
  const listed = keyed("BILL-2", "2025-03-10", 4000, "purchase");
  const journals = postWith([imported, draft, listed], { agedKinds: ["purchase"], openingFigures: { "610": 500000 } });
  assert.equal(sumOf(journals, "610"), 0, "and the opening figure is not touched when no document replaces it");
  assert.equal(sumOf(journals, "800"), 0);
  assert.equal(sumOf(journals, "840"), 0);
  const without = postLedger({
    transactions: [], codeOf: () => null, classify: () => ({ treatment: "exempt", side: "sales" }), chart: CHART,
    bankLabels: new Map(), byId: new Map(), invoices: [keyed("INV-0005", "2025-03-10", 11500)],
    settled: new Map(), transfers: {}, manualJournals: [], startDate: "2025-04-01",
  });
  assert.equal(sumOf(without, "610"), 0, "no owingAtStart option: as before");
});

test("the historical account: Historical Adjustment, else retained earnings, else none", () => {
  assert.equal(historicalAccountIn(CHART).code, "840");
  assert.equal(historicalAccountIn(CHART.filter((a) => a.code !== "840")).code, "960");
  assert.equal(
    historicalAccountIn([{ code: "3900", name: "Retained Earnings", type: "Equity", taxCode: "", description: "" }]).code,
    "3900",
    "QuickBooks' and SlowBooks' charts type it Equity",
  );
  assert.equal(historicalAccountIn(CHART.filter((a) => !["840", "960"].includes(a.code))), null);
  // Several entities: each receivable balanced in its own entity's account.
  const two = [
    { code: "840KC", name: "Historical Adjustment", type: "Historical", taxCode: "", description: "" },
    { code: "840MS", name: "Historical Adjustment", type: "Historical", taxCode: "", description: "" },
    { code: "960RL", name: "Retained Earnings", type: "Retained Earnings", taxCode: "", description: "" },
  ];
  assert.equal(historicalAccountIn(two, "610MS").code, "840MS");
  assert.equal(historicalAccountIn(two, "610RL").code, "960RL", "its own retained earnings before another's adjustment");
  assert.equal(historicalAccountIn(two, "610XX").code, "840KC", "none of its own: the first there is");
});

test("a numbered bill on the same day as an open numberless one is not taken for it", async () => {
  const { documentsInPlay } = await import("../dist/opening-documents.js");
  const bill = (number, total) => ({ number, kind: "purchase", contact: "MCO Cleaning Services", issued: "2026-10-10", total, tax: 0, lines: [] });
  // Xero's aged payables: only the numberless bill of 10 October is open.
  const opening = [{ kind: "purchase", asAt: "2026-10-17", items: [{ number: "MCO Cleaning Services 2026-10-10", owing: 17_050 }] }];
  const out = documentsInPlay([bill("M000471", 22_000), bill("MCO Cleaning Services/2026-10-10", 17_050)], "2026-10-18", opening);
  assert.deepEqual(out.map((b) => [b.number, b.broughtForward]), [["MCO Cleaning Services/2026-10-10", 17_050]]);
});
