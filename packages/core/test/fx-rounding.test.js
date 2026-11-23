import assert from "node:assert/strict";
import test from "node:test";
import { abaFile, accountingInvoice, convert, nzPaymentFile, postInvoice, realisedFxJournals } from "../dist/index.js";

// Code review 2026-11-20, 1.1 and 1.4: converted one by one, a foreign
// document's lines did not add up to its converted total, so its journal did
// not balance; and paid in parts, its receivable was left a cent or two off.

const line = (gross, tax = 0) => ({ description: "", accountCode: "200", taxType: tax === 0 ? "No GST" : "15% GST on Income", net: gross - tax, tax, gross });
const usd = (lines, extra = {}) => {
  const total = lines.reduce((s, l) => s + l.gross, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  return {
    number: "INV-1", kind: "sales", contact: "Acme Inc", reference: "", issued: "2026-04-01", due: null,
    total, tax, paid: 0, outstanding: total, currency: "USD", status: "", lines, ...extra,
  };
};
const sum = (journal) => journal.lines.reduce((s, l) => s + l.amount, 0);

// A small seeded generator, so a failure can be run again.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("three lines of US$3.33 at 1.5 post a journal that balances", () => {
  const nzd = accountingInvoice(usd([line(333), line(333), line(333)]), "NZD", { USD: [{ date: "2026-01-01", rate: 1.5 }] });
  assert.equal(nzd.total, 1499);
  assert.equal(nzd.lines.reduce((s, l) => s + l.gross, 0), 1499, "the lines add up to the total");
  assert.equal(sum(postInvoice(nzd, {})), 0);
});

test("the converted GST adds up to the converted total GST", () => {
  const nzd = accountingInvoice(usd([line(1150, 150), line(1150, 150), line(1150, 150)]), "NZD", { USD: [{ date: "2026-01-01", rate: 1.6667 }] });
  assert.equal(nzd.lines.reduce((s, l) => s + l.tax, 0), nzd.tax);
  assert.ok(nzd.lines.every((l) => l.net === l.gross - l.tax));
});

test("what is outstanding stays the total less what was paid", () => {
  const nzd = accountingInvoice(usd([line(333), line(333), line(334)], { paid: 333, outstanding: 667 }), "NZD", { USD: [{ date: "2026-01-01", rate: 1.5 }] });
  assert.equal(nzd.outstanding, nzd.total - nzd.paid);
});

test("lines that disagreed with the total before are not quietly made to agree", () => {
  const odd = { ...usd([line(333), line(333)]), total: 1000 };
  const nzd = accountingInvoice(odd, "NZD", { USD: [{ date: "2026-01-01", rate: 1.5 }] });
  assert.deepEqual(nzd.lines.map((l) => l.gross), [500, 500], "each line as it converts");
});

test("random foreign documents always post a balanced journal", () => {
  const next = random(20261120);
  for (let n = 0; n < 3_000; n++) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 5) }, () => {
      const gross = 1 + Math.floor(next() * 200_000);
      return line(gross, next() < 0.7 ? Math.round((gross * 3) / 23) : 0);
    });
    const rate = Math.round((0.3 + next() * 2) * 10_000) / 10_000;
    const kind = next() < 0.5 ? "sales" : "purchase";
    const doc = accountingInvoice({ ...usd(lines), kind }, "NZD", { USD: [{ date: "2026-01-01", rate }] });
    assert.equal(sum(postInvoice(doc, {})), 0, `case ${n}: ${lines.length} lines at ${rate}`);
  }
});

test("a foreign sale paid in parts leaves nothing in receivables", () => {
  const next = random(14);
  const control = { code: "610", name: "Accounts Receivable" };
  for (let n = 0; n < 5_000; n++) {
    const total = 1_000 + Math.floor(next() * 500_000);
    const issue = Math.round((1.4 + next() * 0.4) * 10_000) / 10_000;
    const invoice = usd([line(total)]);
    const parts = 1 + Math.floor(next() * 4);
    const rates = { USD: [{ date: "2026-04-01", rate: issue }] };
    const payments = [];
    let left = total;
    for (let k = 0; k < parts; k++) {
      const date = `2026-05-0${k + 1}`;
      const rate = Math.round((1.4 + next() * 0.4) * 10_000) / 10_000;
      rates.USD.push({ date, rate });
      const usdPart = k === parts - 1 ? left : Math.max(1, Math.floor(left * next() * 0.8));
      left -= usdPart;
      payments.push({ invoice, date, amount: convert(usdPart, rate), currency: "NZD", id: `p${k}` });
    }
    const booked = accountingInvoice(invoice, "NZD", rates).total;
    const journals = realisedFxJournals(payments, "NZD", rates, { controlFor: () => control, account: { code: "499", name: "Realised Currency Gains" } });
    const received = payments.reduce((s, p) => s + p.amount, 0);
    const adjusted = journals.flatMap((j) => j.lines).filter((l) => l.accountCode === "610").reduce((s, l) => s + l.amount, 0);
    assert.equal(booked - received + adjusted, 0, `case ${n}: ${parts} parts`);
    assert.ok(journals.every((j) => sum(j) === 0));
  }
});

test("a domestic payment file leaves out a bill in another currency, and says why", () => {
  const payments = [
    { name: "Local Ltd", account: "02-0100-0123456-000", amount: 50_000 },
    { name: "US Supplier", account: "02-0100-0123457-000", amount: 100_000, currency: "USD" },
    { name: "Said NZD", account: "02-0100-0123458-000", amount: 20_000, currency: "nzd" },
  ];
  const nz = nzPaymentFile({ checkAccounts: false, format: "bnz", from: "02-0100-0999999-000", payer: "Us", due: "2026-05-01", created: "2026-05-01", payments });
  assert.equal(nz.count, 2);
  assert.equal(nz.total, 70_000);
  assert.deepEqual(nz.skipped.map((s) => s.name), ["US Supplier"]);
  assert.match(nz.skipped[0].why, /in USD/);

  const au = abaFile({
    from: "062-000 12345678", bank: "CBA", userName: "Us", userId: "123456", description: "CREDITORS",
    date: "2026-05-01", remitter: "Us",
    payments: [{ name: "Sydney Pty", account: "062-000 87654321", amount: 1_000, currency: "NZD" }],
  });
  assert.equal(au.count, 0);
  assert.match(au.skipped[0].why, /in NZD/);
});
