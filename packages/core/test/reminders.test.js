import assert from "node:assert/strict";
import test from "node:test";
import { reminderStage, remindersDue } from "../dist/index.js";

const bal = (number, contact, due, remaining) => ({
  invoice: { number, contact, kind: "sales", issued: due, due, total: remaining, reference: "" },
  remaining,
});
const settings = { days: [7, 14, 21] };
const contacts = { "Harbour Cafe": { email: "pay@harbour.example" }, "Tui Ridge": { email: "a@tui.example", noReminders: true } };
const run = (balances, sent = {}, extra = {}) =>
  remindersDue({ balances, today: "2026-03-30", settings, sent, contactOf: (n) => contacts[n], ...extra });

test("an invoice's stage is how many of the chosen days it has passed", () => {
  assert.equal(reminderStage(6, [7, 14, 21]), 0);
  assert.equal(reminderStage(7, [7, 14, 21]), 1);
  assert.equal(reminderStage(15, [21, 7, 14]), 2);
  assert.equal(reminderStage(40, [7, 14, 21]), 3);
});

test("a customer gets one reminder covering everything past due, once at each stage", () => {
  const balances = [bal("INV-1", "Harbour Cafe", "2026-03-20", 10000), bal("INV-2", "Harbour Cafe", "2026-03-27", 5000)];
  const first = run(balances);
  assert.equal(first.due.length, 1);
  assert.equal(first.due[0].pastDue, 15000);
  assert.deepEqual(first.due[0].invoices.map((i) => [i.balance.invoice.number, i.stage]), [["INV-1", 1], ["INV-2", 0]]);
  // Reminded at stage 1: nothing more until one reaches 14 days.
  assert.equal(run(balances, { "INV-1": 1 }).due.length, 0);
});

test("nothing for a paid invoice, one not yet due, a small total, or a customer who asked not to be", () => {
  assert.equal(run([bal("INV-3", "Harbour Cafe", "2026-03-20", 0)]).due.length, 0);
  assert.equal(run([bal("INV-4", "Harbour Cafe", "2026-04-10", 9000)]).due.length, 0);
  assert.equal(run([bal("INV-5", "Harbour Cafe", "2026-03-20", 900)], {}, { settings: { days: [7], minimum: 1000 } }).due.length, 0);
  const off = run([bal("INV-6", "Tui Ridge", "2026-03-01", 9000)]);
  assert.deepEqual(off.skipped, [{ customer: "Tui Ridge", why: "set to have no reminders" }]);
  const nobody = run([bal("INV-7", "Nobody", "2026-03-01", 9000)]);
  assert.deepEqual(nobody.skipped, [{ customer: "Nobody", why: "no email address" }]);
});
