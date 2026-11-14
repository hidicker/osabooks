import assert from "node:assert/strict";
import test from "node:test";
import { isCreditNote, looksLikeCreditTypedAsSale, negatedDocument } from "../dist/invoices.js";

const doc = (extra = {}) => ({
  number: "CN-1",
  kind: "sales",
  contact: "A Customer",
  reference: "",
  issued: "2026-06-01",
  due: null,
  total: 11500,
  tax: 1500,
  paid: 0,
  outstanding: 11500,
  currency: "NZD",
  status: "Credit note",
  lines: [{ description: "Refund", accountCode: "200", taxType: "15% GST on Income", net: 10000, tax: 1500, gross: 11500 }],
  ...extra,
});

test("a sales document called a credit with positive amounts is caught", () => {
  assert.equal(looksLikeCreditTypedAsSale(doc()), true);
  assert.equal(looksLikeCreditTypedAsSale(doc({ status: "credit" })), true);
});

test("an ordinary sale, a real credit note and a bill are left alone", () => {
  assert.equal(looksLikeCreditTypedAsSale(doc({ status: "Awaiting Payment" })), false);
  assert.equal(looksLikeCreditTypedAsSale(doc({ status: "Paid by credit card" })), false);
  assert.equal(looksLikeCreditTypedAsSale(doc({ status: "Accredited" })), false);
  assert.equal(looksLikeCreditTypedAsSale(negatedDocument(doc())), false);
  assert.equal(looksLikeCreditTypedAsSale(doc({ kind: "purchase" })), false);
});

test("turned round, every amount is negative and it is a credit note", () => {
  const credit = negatedDocument(doc({ paid: 2000, outstanding: 9500, broughtForward: 9500 }));
  assert.equal(isCreditNote(credit), true);
  assert.deepEqual(
    [credit.total, credit.tax, credit.paid, credit.outstanding, credit.broughtForward],
    [-11500, -1500, -2000, -9500, -9500],
  );
  assert.deepEqual([credit.lines[0].net, credit.lines[0].tax, credit.lines[0].gross], [-10000, -1500, -11500]);
  assert.equal(credit.lines[0].accountCode, "200");
  assert.equal(credit.number, "CN-1");
});
