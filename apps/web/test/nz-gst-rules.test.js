import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Two New Zealand GST rules on when a sale counts. On the payments basis, a
 * sale over $225,000 counts when invoiced, unless paid in full within 365
 * days. On the invoice basis, a payment made before the invoice is issued
 * makes the GST on it due when paid. Worked out from a set of books, as the
 * GST return page works them out.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-gst-rules-"));
const entry = join(out, "entry.ts");
const src = (f) => JSON.stringify(join(root, "src", f).split("\\").join("/"));
writeFileSync(
  entry,
  `export { state } from ${src("state.ts")};\nexport { varianceInput } from ${src("books.ts")};\n` +
    `export { computeOurReturns } from ${src("variance.ts")};\nexport { applyCountryRules } from ${src("country.ts")};\n` +
    `export { holdWrites } from ${src("store.ts")};\n`,
);
const bundle = join(out, "books.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const app = await import(pathToFileURL(bundle).href);
app.holdWrites();

const chart = [
  { code: "090", name: "Bank", type: "Bank", taxCode: "No GST", description: "" },
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
];
const bankLine = (id, date, amount, reference) => ({
  id, date, amount, currency: "NZD", serial: "", trn: "", particulars: "", code: "", reference,
  otherParty: "Customer", origin: "", type: "", batch: "", otherPartyAccount: "", account: "bank-1",
  occurrence: 1, source: { importer: "test", file: "t.csv", line: 1 }, extras: {},
});
const invoice = (number, issued, gross) => ({
  number, kind: "sales", contact: "Customer", reference: "", issued, due: null,
  total: gross, tax: Math.round((gross * 3) / 23), paid: 0, outstanding: gross, currency: "NZD", status: "Awaiting Payment",
  lines: [{ description: "Work", accountCode: "200", taxType: "15% GST on Income", gross, tax: Math.round((gross * 3) / 23), net: gross - Math.round((gross * 3) / 23) }],
});
/** Within a few cents: Box 5 is worked back from GST rounded on each line, as Xero's is. */
const near = (actual, expected, what) => assert.ok(Math.abs((actual ?? 0) - expected) <= 10, `${what}: ${actual} against ${expected}`);

function books({ transactions, invoices, matches, basis }) {
  app.state.ledger = {
    version: 1, jurisdiction: "nz", transactions, invoices, invoiceMatches: matches, chart,
    entities: { entities: [{ id: "co", name: "Co Ltd", gstRegistered: true, gstBasis: basis }], accounts: {}, banks: { "bank-1": ["co"] } },
  };
  app.state.chart = chart;
  app.applyCountryRules();
  return Object.fromEntries(
    app.computeOurReturns(app.varianceInput(basis === "accruals" ? "accruals" : "cash"), "2026-04-01", "2027-03-31").map((r) => [r.period.to, r.boxes.box5]),
  );
}

test("payments basis: a sale over $225,000 counts when invoiced, not as its instalments come in", () => {
  // $300,000 invoiced on 10 May, paid in two halves in July 2026 and in 2027.
  const boxes = books({
    basis: "cash",
    invoices: [invoice("INV-1", "2026-05-10", 30_000_000)],
    transactions: [bankLine("p1", "2026-07-15", 15_000_000, "INV-1")],
    matches: { p1: "INV-1" },
  });
  near(boxes["2026-05-31"], 30_000_000, "all of it in the period invoiced");
  near(boxes["2026-07-31"] ?? 0, 0, "and the payment counts nothing more");
});

test("payments basis: a large sale paid in full within the year stays on the payments basis", () => {
  const boxes = books({
    basis: "cash",
    invoices: [invoice("INV-2", "2026-05-10", 30_000_000)],
    transactions: [bankLine("p2", "2026-07-15", 30_000_000, "INV-2")],
    matches: { p2: "INV-2" },
  });
  near(boxes["2026-05-31"] ?? 0, 0, "Box 5");
  near(boxes["2026-07-31"], 30_000_000, "Box 5");
});

test("invoice basis: a deposit paid before the invoice counts when it was paid", () => {
  // $5,000 deposit on 20 April, the $11,500 invoice issued on 15 May.
  const boxes = books({
    basis: "accruals",
    invoices: [invoice("INV-3", "2026-05-15", 1_150_000)],
    transactions: [bankLine("d1", "2026-04-20", 500_000, "INV-3")],
    matches: { d1: "INV-3" },
  });
  near(boxes["2026-05-31"], 1_150_000, "April and May are one two-monthly period");
  const split = books({
    basis: "accruals",
    invoices: [invoice("INV-4", "2026-06-02", 1_150_000)],
    transactions: [bankLine("d2", "2026-05-20", 500_000, "INV-4")],
    matches: { d2: "INV-4" },
  });
  near(split["2026-05-31"], 500_000, "the deposit in the period it was paid");
  near(split["2026-07-31"], 650_000, "the rest when invoiced");
});
