import assert from "node:assert/strict";
import test from "node:test";
import { dedupeReference, inferAccountMapping } from "../dist/index.js";

const line = (over) => ({
  date: "2026-05-01", amount: -11500, code: "429", label: "429 Office Expenses",
  source: "export.xlsx", account: "Business Bank Account", ...over,
});

test("the same export loaded twice adds nothing the second time", () => {
  const once = [line(), line({ amount: 23000, code: "200" })];
  assert.equal(dedupeReference(once, once).length, 2);
});

test("the same posting under two filenames is still one posting", () => {
  const a = line({ source: "april.xlsx" });
  const b = line({ source: "april (1).xlsx" });
  assert.equal(dedupeReference([a], [b]).length, 1);
});

test("genuinely different lines all survive", () => {
  const lines = [
    line(),
    line({ date: "2026-05-02" }),
    line({ amount: -11501 }),
    line({ code: "400" }),
    line({ account: "Credit Card" }),
    line({ gstRate: "No GST" }),
  ];
  assert.equal(dedupeReference([], lines).length, lines.length);
});

test("identical postings in one file are all kept, and loading it again adds none", () => {
  // Three $20 memberships paid on one day are three payments. Collapsed, two
  // of them had nothing in the file to be compared with.
  const once = dedupeReference([], [line(), line(), line()]);
  assert.equal(once.length, 3);
  assert.equal(dedupeReference(once, [line(), line(), line()]).length, 3, "the same file again adds nothing");
  assert.equal(dedupeReference(once, [line(), line(), line(), line()]).length, 4, "a fourth is new");
});

test("duplicates are what stop an account being paired at all", () => {
  // The fault this exists to prevent, in miniature. The mapper only counts
  // unambiguous pairs and wants three of them, so with the reference doubled
  // every amount has two candidates, nothing is unambiguous, and the mapping
  // comes back empty -- which is the difference between coding suggestions and
  // none. On one real set of books it was two pairings against zero.
  const amounts = [-11500, 23000, -4250, 8800];
  const ours = amounts.map((amount, i) => ({
    transaction: {
      id: String(i), date: `2026-05-0${i + 1}`, amount,
      account: "02-1100-0022001-000",
    },
    code: "(uncoded)",
  }));
  const clean = amounts.map((amount, i) => line({ date: `2026-05-0${i + 1}`, amount }));
  const doubled = [...clean, ...clean];

  assert.ok(inferAccountMapping(ours, clean).size > 0, "a clean reference pairs the account");
  assert.equal(inferAccountMapping(ours, doubled).size, 0, "a doubled one pairs nothing");
  assert.ok(
    inferAccountMapping(ours, dedupeReference(clean, clean)).size > 0,
    "deduplicating puts it back",
  );
});

test("Xero's two Account Transactions reports give the same lines once", () => {
  // The bank-only report writes "469 - Rent" with no rate and no split; the
  // full report writes "469 Rent" with both. Loaded together they doubled every
  // line, and each spare copy showed as missing from the books.
  const bankOnly = [
    line({ code: "469 - Rent", label: "469 - Rent", amount: -165000, source: "bank.xlsx" }),
    line({ code: "477 - Wages and Salaries", label: "477 - Wages and Salaries", amount: -193800, source: "bank.xlsx" }),
  ];
  const parts = [
    { code: "477 Wages and Salaries", label: "477 Wages and Salaries", amount: -250000 },
    { code: "825 PAYG Withholdings Payable", label: "825 PAYG Withholdings Payable", amount: 56200 },
  ];
  const full = [
    line({ code: "469 Rent", label: "469 Rent", amount: -165000, gstRate: "GST on Expenses", source: "full.xlsx" }),
    line({ code: "477 Wages and Salaries", label: "477 Wages and Salaries", amount: -193800, gstRate: "BAS Excluded", parts, source: "full.xlsx" }),
  ];
  const merged = dedupeReference(bankOnly, full);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].gstRate, "GST on Expenses", "the rate is taken from the report that has it");
  assert.equal(merged[1].parts.length, 2, "and the split");
});

test("books already holding both reports are put right as they open", () => {
  const held = [
    line({ code: "469 - Rent", label: "469 - Rent", source: "bank.xlsx" }),
    line({ code: "469 Rent", label: "469 Rent", gstRate: "GST on Expenses", source: "full.xlsx" }),
    line({ code: "469 Rent", label: "469 Rent", gstRate: "GST on Expenses", source: "full.xlsx" }),
  ];
  assert.equal(dedupeReference(held).length, 2, "one pair merged; the second payment in one file stays");
});
