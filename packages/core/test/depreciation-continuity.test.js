import assert from "node:assert/strict";
import test from "node:test";
import { depreciationSchedule } from "../dist/index.js";

// Code review 2026-11-20, 14: straight line's earlier depreciation was one
// rounded charge over the whole span, while each year charged its own
// rounded slice, so a year could open a cent off last year's close, and the
// depreciation posted year by year did not add up to cost less book value.

const asset = (extra) => ({
  number: "FA-1", name: "Asset", type: "Plant", status: "Registered", purchased: null,
  depreciationFrom: "2016-03-17", cost: 100_000, rate: 13, method: "SL", averaging: "full month", disposed: null,
  ...extra,
});
const year = (y) => ({ from: `${y}-04-01`, to: `${y + 1}-03-31` });

function run(a, years, options) {
  const rows = [];
  for (let y = 2015; y < 2015 + years; y++) {
    const row = depreciationSchedule([a], year(y), options).rows[0];
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

let seed = 77;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

for (const [label, options] of [["by months", {}], ["by days", { byDays: true }]]) {
  test(`each year opens at last year's close, both methods, ${label}`, () => {
    for (let n = 0; n < 1_500; n++) {
      const day = 1 + Math.floor(next() * 28);
      const a = asset({
        depreciationFrom: `${2015 + Math.floor(next() * 4)}-${String(1 + Math.floor(next() * 12)).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        cost: 1_000 + Math.floor(next() * 5_000_000),
        rate: [10, 12.5, 13, 16, 20, 25, 30, 40, 50, 67][Math.floor(next() * 10)],
        method: next() < 0.5 ? "SL" : "DV",
      });
      const rows = run(a, 15, options);
      for (let i = 1; i < rows.length; i++) {
        assert.equal(rows[i].opening, rows[i - 1].closing, `asset ${n} (${a.method} ${a.rate}% from ${a.depreciationFrom}), year ${i}`);
      }
      // What is posted year by year is what the register has taken off.
      // (An asset bought before the first year run is part written down by then.)
      const before = a.cost - rows[0].opening;
      const posted = before + rows.reduce((s, r) => s + r.depreciation, 0);
      const last = rows[rows.length - 1];
      assert.equal(posted, a.cost - last.closing, `asset ${n}: charges against the register`);
      assert.equal(last.accumulated, posted, `asset ${n}: accumulated`);
      assert.ok(rows.every((r) => r.closing >= 0));
    }
  });
}

test("a straight-line asset written down in full stops at nil", () => {
  const rows = run(asset({ rate: 50, cost: 99_999 }), 6, {});
  assert.equal(rows[rows.length - 1].closing, 0);
  assert.ok(rows.every((r) => r.depreciation >= 0));
});
