import assert from "node:assert/strict";
import test from "node:test";
import { collectionLetter, customerStatement, owingByCurrency, owingSaid, remindersDue } from "../dist/index.js";

/**
 * What a customer owes, told in each invoice's own currency and never added
 * across them: a US$800 and an NZ$300 invoice overdue are not "$1,100.00"
 * (code review of 20 November, 1.5).
 */

const supplier = { name: "Kea Coffee Roasters" };
const line = (number, owing, currency, due = "2026-10-01") => ({ number, issued: "2026-09-01", due, total: owing, owing, reference: "", currency });

test("added up in each currency, the books' own first", () => {
  const sums = owingByCurrency([line("A", 80_000, "USD"), line("B", 30_000, "NZD"), line("C", 5_000, "usd"), line("D", 1_000, undefined)], "NZD");
  assert.deepEqual(sums, [{ currency: "NZD", owing: 31_000 }, { currency: "USD", owing: 85_000 }]);
  assert.equal(owingSaid(sums, "NZD"), "310.00 and 850.00 USD");
  assert.equal(owingSaid(owingByCurrency([line("B", 30_000, "NZD")], "NZD"), "NZD"), "300.00");
});

test("the reminder letter: each line in its currency, a past-due total for each", () => {
  const html = collectionLetter("Acme", [line("INV-1", 80_000, "USD"), line("INV-2", 30_000, "NZD")], "2026-11-20", supplier, 1, { currency: "NZD" });
  assert.match(html, /past due, 300\.00 and 800\.00 USD in all/);
  assert.match(html, /<td class="n">800\.00 USD<\/td>/);
  assert.match(html, /Past due in NZD<\/td><td class="n">300\.00/);
  assert.match(html, /Past due in USD<\/td><td class="n">800\.00 USD/);
  assert.doesNotMatch(html, /1,?100\.00/);
});

test("all in the books' currency, the letter reads as it always did", () => {
  const html = collectionLetter("Acme", [line("INV-1", 80_000, "NZD"), line("INV-2", 30_000, undefined)], "2026-11-20", supplier, 1, { currency: "NZD" });
  assert.match(html, /past due, 1100\.00 in all/);
  assert.match(html, /Past due<\/td><td class="n">1100\.00/);
});

test("the statement: totals for each currency, and ageing only where there is one", () => {
  const mixed = customerStatement("Acme", [line("INV-1", 80_000, "USD"), line("INV-2", 30_000, "NZD")], "2026-11-20", supplier, { currency: "NZD" });
  assert.match(mixed, /Total owing in USD<\/td><td class="n">800\.00 USD/);
  assert.doesNotMatch(mixed, /Over 90 days/);
  const one = customerStatement("Acme", [line("INV-2", 30_000, "NZD")], "2026-11-20", supplier, { currency: "NZD" });
  assert.match(one, /Total owing<\/td><td class="n">300\.00/);
  assert.match(one, /Over 90 days/);
});

test("reminders: the minimum is measured in the books' money, the totals kept by currency", () => {
  const balances = [
    { invoice: { number: "INV-1", contact: "Acme", kind: "sales", issued: "2026-09-01", due: "2026-10-01", total: 10_000, reference: "", currency: "USD" }, remaining: 10_000 },
    { invoice: { number: "INV-2", contact: "Acme", kind: "sales", issued: "2026-09-01", due: "2026-10-01", total: 3_000, reference: "", currency: "NZD" }, remaining: 3_000 },
  ];
  const base = { balances, today: "2026-11-20", sent: {}, contactOf: () => ({ email: "acme@example.com" }), books: "NZD" };
  // US$100 is NZ$170 here: with NZ$30, NZ$200 past due, over a NZ$150 minimum.
  const inBooks = (b) => (b.invoice.currency === "USD" ? Math.round(b.remaining * 1.7) : b.remaining);
  const due = remindersDue({ ...base, settings: { days: [7], minimum: 15_000 }, inBooks });
  assert.equal(due.due.length, 1);
  assert.equal(due.due[0].pastDue, 20_000);
  assert.deepEqual(due.due[0].pastDueByCurrency, [{ currency: "NZD", owing: 3_000 }, { currency: "USD", owing: 10_000 }]);
  // Under a NZ$250 minimum, nothing goes.
  assert.equal(remindersDue({ ...base, settings: { days: [7], minimum: 25_000 }, inBooks }).due.length, 0);
});
