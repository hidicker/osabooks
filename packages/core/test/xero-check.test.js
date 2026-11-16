import assert from "node:assert/strict";
import test from "node:test";
import { balancesOn, compareBalances, movementsBetween } from "../dist/index.js";

const line = (code, amount, name = code) => ({ accountCode: code, accountName: name, amount, taxType: "NONE", description: "" });
const bank = (account, amount) => ({ accountCode: "", accountName: account, amount, taxType: "NONE", description: "" });
const journal = (date, lines) => ({ transactionId: date, date, narration: "", lines, source: "bank", taxBasis: "payments" });

test("accounts that agree are counted, and those that differ are listed, largest first", () => {
  const theirs = { "200": -100000, "429": 25000, "610": 5000 };
  const ours = { "200": -100000, "429": 24000, "610": 7000 };
  const result = compareBalances(theirs, ours);
  assert.equal(result.compared, 3);
  assert.equal(result.agree, 1);
  assert.deepEqual(
    result.differences.map((d) => [d.account, d.theirs, d.ours, d.difference]),
    [["610", 5000, 7000, 2000], ["429", 25000, 24000, -1000]],
  );
});

test("an account on one side only shows as a difference rather than dropping out", () => {
  const result = compareBalances({ "416": 50000 }, { "437": -1200 });
  assert.equal(result.compared, 2);
  assert.equal(result.agree, 0);
  assert.deepEqual(result.differences.map((d) => [d.account, d.theirs, d.ours]), [["416", 50000, 0], ["437", 0, -1200]]);
});

test("nothing on either side is not counted, and a tolerance lets cents agree", () => {
  const result = compareBalances({ "800": 0, "820": 10001 }, { "820": 10000 }, 1);
  assert.equal(result.compared, 1);
  assert.equal(result.agree, 1);
});

test("a year's movement on every account, income and expenses included, from the journals", () => {
  const journals = [
    journal("2026-03-31", [bank("bnz-01", 99), line("200", -99)]),
    journal("2026-05-01", [bank("bnz-01", 11500), line("200", -10000), line("820", -1500)]),
    journal("2026-06-01", [bank("bnz-01", -2300), line("429", 2000), line("820", 300)]),
    journal("2027-04-01", [bank("bnz-01", 5), line("200", -5)]),
  ];
  const moved = movementsBetween(journals, "2026-04-01", "2027-03-31");
  assert.deepEqual(moved, { "bnz-01": 9200, "200": -10000, "820": -1200, "429": 2000 });
});

test("balances on a year end carry the profit since the opening into retained earnings, as a trial balance column is read", () => {
  const opening = { asAt: "2026-04-01", accounts: { "bnz-01": 100000, "960": -100000 } };
  const journals = [
    journal("2026-05-01", [bank("bnz-01", 11500), line("200", -10000), line("820", -1500)]),
    journal("2026-06-01", [bank("bnz-01", -2300), line("429", 2000), line("820", 300)]),
  ];
  const profitAndLoss = (key) => key === "200" || key === "429";
  const at = balancesOn(opening, journals, "2027-03-31", profitAndLoss, "960");
  assert.deepEqual(at, { "bnz-01": 109200, "960": -108000, "820": -1200 });
  assert.equal(Object.values(at).reduce((s, v) => s + v, 0), 0, "they balance, as a trial balance does");
  assert.equal(balancesOn(opening, journals, "2026-03-31", profitAndLoss, "960"), null, "the column the opening came from proves nothing");
});

test("Xero's year end against the books', set side by side", () => {
  const opening = { asAt: "2026-04-01", accounts: { "bnz-01": 100000, "960": -100000 } };
  const journals = [journal("2026-05-01", [bank("bnz-01", 11500), line("200", -10000), line("820", -1500)])];
  const ours = balancesOn(opening, journals, "2027-03-31", (k) => k === "200", "960");
  // Xero has a depreciation journal the books do not: 500 off the asset, 500 off profit.
  const xero = { "bnz-01": 111500, "820": -1500, "721": -500, "960": -109500 };
  const result = compareBalances(xero, ours);
  assert.equal(result.agree, 2);
  assert.deepEqual(result.differences.map((d) => [d.account, d.difference]), [["721", 500], ["960", -500]]);
});
