import assert from "node:assert/strict";
import test from "node:test";
import { depreciationJournals, depreciationStillToPost } from "../dist/index.js";

// A 12,000 asset at 20% straight line from the start of a New Zealand year
// (1 April 2026): 2,400 a year, 200 a month.
const van = {
  number: "FA-1", name: "Van", type: "Motor Vehicles", status: "Registered",
  purchased: "2026-04-01", depreciationFrom: "2026-04-01", cost: 1_200_000, rate: 20,
  method: "Straight Line", averaging: "Full Month", disposed: null,
};
const chart = [
  { code: "416", name: "Depreciation", type: "Expense" },
  { code: "711", name: "Less Accumulated Depreciation on Motor Vehicles", type: "Fixed Asset" },
];
const line = (date) => ({ id: date, date, amount: -100, currency: "NZD", account: "b", otherParty: "", particulars: "", code: "", reference: "", extras: {}, source: { file: "f", line: 1 } });

test("the year's depreciation still to post: posted months plus the estimate are the whole year", () => {
  const today = "2026-11-24";
  const posted = depreciationJournals({ assets: [van], transactions: [line("2026-05-01")], chart, today })
    .flatMap((j) => j.lines)
    .filter((l) => l.accountCode === "416")
    .reduce((s, l) => s + l.amount, 0);
  const estimate = depreciationStillToPost([van], { today, to: "2027-03-31" });
  assert.equal(estimate.to, "2027-03-31");
  assert.ok(estimate.amount > 0, "months are still to come");
  // Whatever the schedule's own rounding, the two add to the year's charge.
  const whole = depreciationJournals({ assets: [van], transactions: [line("2026-05-01")], chart })
    .flatMap((j) => j.lines)
    .filter((l) => l.accountCode === "416")
    .reduce((s, l) => s + l.amount, 0);
  assert.equal(posted + estimate.amount, whole);
});

test("never past the financial year's end", () => {
  const estimate = depreciationStillToPost([van], { today: "2026-11-24", to: "2027-12-31" });
  assert.equal(estimate.to, "2027-03-31");
  assert.equal(estimate.amount, depreciationStillToPost([van], { today: "2026-11-24", to: "2027-03-31" }).amount);
});

test("nothing for a period already over, or with no assets", () => {
  assert.equal(depreciationStillToPost([van], { today: "2026-11-24", to: "2026-10-31" }).amount, 0);
  assert.equal(depreciationStillToPost([], { today: "2026-11-24", to: "2027-03-31" }).amount, 0);
});

test("a year ending in December, as a United States book's does", () => {
  const usVan = { ...van, purchased: "2026-01-01", depreciationFrom: "2026-01-01" };
  const estimate = depreciationStillToPost([usVan], { today: "2026-11-24", to: "2026-12-31", yearEnd: { endMonth: 12, endDay: 31 } });
  assert.equal(estimate.to, "2026-12-31");
  assert.ok(estimate.amount > 0 && estimate.amount < 1_200_000 * 0.2, "about a month and a half of the year");
});
