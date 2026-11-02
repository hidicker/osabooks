import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { salesTaxFraction } from "@nzosa/core";
import { loadLedger } from "../dist/ledger.js";

/** Opening books sets the rate of GST for them, as the app does. */
const file = (jurisdiction) => {
  const path = join(mkdtempSync(join(tmpdir(), "nzosa-country-")), "ledger.json");
  writeFileSync(path, JSON.stringify({ version: 1, transactions: [], ...(jurisdiction ? { jurisdiction } : {}) }));
  return path;
};

test("Australian books work out GST at 1/11", () => {
  const ledger = loadLedger(file("au"));
  assert.equal(ledger.jurisdiction, "au");
  assert.deepEqual(salesTaxFraction(), { num: 1, den: 11 });
});

test("books that name no country are New Zealand's, at 3/23", () => {
  loadLedger(file("au"));
  loadLedger(file(undefined));
  assert.deepEqual(salesTaxFraction(), { num: 3, den: 23 });
});
