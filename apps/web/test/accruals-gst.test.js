import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * GST on the accruals basis: an invoice counts when issued, and the payment
 * that settles it counts nothing more; on the cash basis, the other way round.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-accruals-"));
const bundle = join(out, "variance.mjs");
await build({
  entryPoints: [join(root, "src", "variance.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const { computeOurReturns } = await import(pathToFileURL(bundle).href);

const line = (id, date, amount) => ({
  id, date, amount, currency: "NZD", serial: "", trn: "", particulars: "", code: "", reference: "",
  otherParty: "", origin: "", type: "", batch: "", otherPartyAccount: "", account: "bank",
  occurrence: 1, source: { importer: "test", file: "t.csv", line: 1 }, extras: {},
});
const doc = (id, date, amount, side, ref) => ({
  transaction: { ...line(id, date, amount), account: "", reference: ref, source: { importer: "document", file: "", line: 0 } },
  treatment: "standard", side, code: side === "sales" ? "200" : "400",
});

// Paid on 5 August for an invoice of 10 June; a bill of 1 July still owing; a
// purchase straight from the bank on 15 June.
const receipt = line("r", "2026-08-05", 115000);
const purchase = line("p", "2026-06-15", -11500);
const input = (accrualDocuments) => ({
  transactions: [receipt, purchase],
  splits: {},
  overrides: {
    r: { confirmed: true, code: "610", treatment: "standard", side: "sales" },
    p: { confirmed: true, code: "400", treatment: "standard", side: "purchases" },
  },
  rules: undefined,
  notes: [],
  accounts: [],
  months: 2,
  settles: (id) => (id === "r" ? { side: "sales", taxable: 1, number: "INV1" } : undefined),
  ...(accrualDocuments ? { accrualDocuments } : {}),
});
const byEnd = (returns) => Object.fromEntries(returns.map((r) => [r.period.to, r.boxes]));

test("cash: the sale counts when paid, the unpaid bill not at all", () => {
  const boxes = byEnd(computeOurReturns(input(), "2026-06-01", "2026-09-30"));
  assert.equal(boxes["2026-07-31"].box5, 0);
  assert.equal(boxes["2026-07-31"].box11, 11500);
  assert.equal(boxes["2026-09-30"].box5, 115000);
});

test("accruals: the sale counts when invoiced, the bill when issued, the payment not again", () => {
  const docs = [doc("doc:sales:INV1:0", "2026-06-10", 115000, "sales", "INV1"), doc("doc:purchase:B1:0", "2026-07-01", -23000, "purchases", "B1")];
  const boxes = byEnd(computeOurReturns(input(docs), "2026-06-01", "2026-09-30"));
  assert.equal(boxes["2026-07-31"].box5, 115000);
  assert.equal(boxes["2026-07-31"].box11, 34500, "the bill and the bank purchase");
  assert.equal(boxes["2026-09-30"].box5, 0, "the receipt only cleared what was owed");
});
