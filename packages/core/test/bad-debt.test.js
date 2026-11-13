import { test } from "node:test";
import assert from "node:assert/strict";
import { outsidePaymentJournals, taxSummary } from "../dist/index.js";

// A refund is a sale with a negative total, paid back at the counter.
const refundReceipt = {
  number: "SR-0002", kind: "sales", contact: "Walk-in customer", reference: "", issued: "2026-02-03", due: null,
  total: -54125, tax: -4125, paid: -54125, outstanding: 0, currency: "USD", status: "Paid", receipt: true,
  lines: [{ description: "Refund", accountCode: "4000", taxType: "8.25%", gross: -54125, tax: -4125, net: -50000 }],
  paidOutside: [{ date: "2026-02-03", amount: 54125, accountCode: "1000", note: "Sales receipt" }],
};

const invoice = (paidOutside) => ({
  number: "INV-9",
  kind: "sales",
  contact: "Slow Payer Ltd",
  reference: "",
  issued: "2026-04-10",
  due: "2026-05-10",
  total: 11500,
  tax: 1500,
  paid: 0,
  outstanding: 11500,
  currency: "NZD",
  status: "Awaiting Payment",
  lines: [{ description: "Work", accountCode: "200", taxType: "15% GST on Income", net: 10000, tax: 1500, gross: 11500 }],
  paidOutside,
});
const options = {
  control: { code: "610", name: "Accounts Receivable" },
  gst: { code: "820", name: "GST" },
};

test("a debt written off: the GST comes back out, and only the invoice basis claims it", () => {
  const [journal] = outsidePaymentJournals(
    invoice([{ date: "2026-09-30", amount: 11500, accountCode: "Bad debts - 465", note: "Written off", writeOff: true }]),
    options,
  );
  assert.deepEqual(
    journal.lines.map((l) => [l.accountCode, l.amount, l.taxType]),
    [
      ["610", -11500, "NONE"],
      ["Bad debts - 465", 10000, "NONE"],
      ["820", 1500, "BADDEBT"],
    ],
  );
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(taxSummary([journal], { basis: "invoice" }).box13, 1500);
  // Never returned on the payments basis, so nothing to claim back -- and never received.
  const payments = taxSummary([journal], { basis: "payments" });
  assert.equal(payments.box13, 0);
  assert.equal(payments.box5, 0);
});

test("part of a debt written off claims the GST in that part", () => {
  const [journal] = outsidePaymentJournals(
    invoice([{ date: "2026-09-30", amount: 2300, accountCode: "465", writeOff: true }]),
    options,
  );
  assert.equal(journal.lines.find((l) => l.taxType === "BADDEBT")?.amount, 300);
});

test("a payment received outside the bank is still a payment", () => {
  const [journal] = outsidePaymentJournals(invoice([{ date: "2026-09-30", amount: 11500, accountCode: "880" }]), options);
  assert.equal(taxSummary([journal], { basis: "payments" }).box5, 11500);
});

test("a refund paid back at the counter takes the money out of the bank and clears the credit", () => {
  const [journal] = outsidePaymentJournals(refundReceipt, { control: { code: "1200", name: "Accounts receivable" } });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(journal.lines.find((l) => l.accountCode === "1000").amount, -54125, "money out of checking");
  assert.equal(journal.lines.find((l) => l.accountCode === "1200").amount, 54125, "the credit the refund settles");

  const sale = { ...refundReceipt, total: 54125, tax: 4125, paid: 54125, number: "SR-0001" };
  const [paid] = outsidePaymentJournals(sale, { control: { code: "1200", name: "Accounts receivable" } });
  assert.equal(paid.lines.find((l) => l.accountCode === "1000").amount, 54125, "the sale it reverses took the money in");
});
