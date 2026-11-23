import assert from "node:assert/strict";
import test from "node:test";
import { minorUnits, missingRates, ratesStartLate } from "../dist/index.js";

/**
 * What the reports say about other currencies (code review of 20 November,
 * 1.2 and 1.3): a currency with no rate at all, and one used before its first
 * rate held, which then takes that later rate.
 */

const inUse = new Map([
  ["USD", { from: "2026-03-10", to: "2026-09-01", lines: 3, documents: 1 }],
  ["AUD", { from: "2026-07-01", to: "2026-08-01", lines: 1, documents: 0 }],
  ["EUR", { from: "2026-05-01", to: "2026-05-01", lines: 1, documents: 0 }],
]);
const rates = {
  USD: [{ date: "2026-06-01", rate: 0.6 }, { date: "2026-08-01", rate: 0.59 }],
  AUD: [{ date: "2026-06-30", rate: 0.9 }],
  EUR: [{ date: "2026-01-01", rate: 0 }],
};

test("a currency with no usable rate", () => {
  assert.deepEqual(missingRates(inUse, rates), ["EUR"]);
});

test("a currency used before its first rate, and only that", () => {
  assert.deepEqual(ratesStartLate(inUse, rates), [{ currency: "USD", from: "2026-03-10", firstRate: "2026-06-01" }]);
});

test("three-decimal currencies are known as such", () => {
  assert.equal(minorUnits("KWD"), 3);
  assert.equal(minorUnits("NZD"), 2);
});
