import assert from "node:assert/strict";
import test from "node:test";
import {
  betweenEntityJournals,
  everyOwner,
  ownerRenamed,
  ownerRentalSchedule,
  ownersOn,
  ownersOver,
  renameOwnerInModel,
  sharesFrom,
  validateEntityModel,
} from "../dist/index.js";

// Totara Street: Ana and Tom half each until 30 September 2025, then Ana 70% and Tom 30%.
const halves = [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }];
const after = [{ name: "Ana", percent: 70 }, { name: "Tom", percent: 30 }];
const totara = sharesFrom({ id: "totara", name: "Totara Street", kind: "commercial", owners: halves }, "2025-10-01", after);

test("new shares from a date keep the old ones for the days before", () => {
  assert.deepEqual(totara.owners, after);
  assert.deepEqual(totara.earlierOwners, [{ until: "2025-09-30", owners: halves }]);
  assert.deepEqual(ownersOn(totara, "2025-09-30"), halves);
  assert.deepEqual(ownersOn(totara, "2025-10-01"), after);
  assert.deepEqual(ownersOn(totara, "2020-01-01"), halves);
});

test("across a year, each set of shares counts for its days", () => {
  // 1 April 2025 to 31 March 2026: 183 days at 50/50, 182 at 70/30.
  const year = ownersOver(totara, "2025-04-01", "2026-03-31");
  const ana = year.find((o) => o.name === "Ana").percent;
  const tom = year.find((o) => o.name === "Tom").percent;
  assert.ok(Math.abs(ana - (50 * 183 + 70 * 182) / 365) < 1e-9, String(ana));
  assert.ok(Math.abs(ana + tom - 100) < 1e-9);
  // A year wholly before the change keeps the old shares exactly.
  assert.deepEqual(ownersOver(totara, "2024-04-01", "2025-03-31"), halves);
  assert.deepEqual(ownersOver(totara, "2026-04-01", "2027-03-31"), after);
});

test("a second change from an earlier date gives way to it", () => {
  const again = sharesFrom(totara, "2025-07-01", [{ name: "Ana", percent: 60 }, { name: "Tom", percent: 40 }]);
  assert.deepEqual(again.earlierOwners, [{ until: "2025-06-30", owners: halves }]);
  assert.deepEqual(ownersOn(again, "2025-12-01"), [{ name: "Ana", percent: 60 }, { name: "Tom", percent: 40 }]);
});

test("someone who has left is still an owner of the years they held a share", () => {
  const sold = sharesFrom({ id: "x", name: "X", owners: halves }, "2026-01-01", [{ name: "Ana", percent: 100 }]);
  assert.deepEqual(everyOwner(sold).map((o) => o.name), ["Ana", "Tom"]);
});

test("shares that do not total 100 are said for the earlier ones too", () => {
  const wrong = { ...totara, earlierOwners: [{ until: "2025-09-30", owners: [{ name: "Ana", percent: 50 }] }] };
  const problems = validateEntityModel({ entities: [wrong], accounts: {}, banks: {} }, [], []);
  assert.ok(problems.some((p) => /up to 2025-09-30 total 50%/.test(p.message)), JSON.stringify(problems));
});

test("money between entities splits by the shares on the line's date", () => {
  const model = {
    entities: [{ id: "both", name: "Both", kind: "personal", owners: halves }, totara],
    accounts: { "473TS": "totara" },
    banks: { joint: ["both"] },
  };
  const options = { model, bankOwner: (a) => model.banks[a]?.[0], isBank: (c) => c === "joint" };
  const journal = (id, date) => ({
    transactionId: id,
    date,
    narration: id,
    lines: [
      { accountCode: "joint", accountName: "joint", amount: -100000, taxType: "NONE", description: "" },
      { accountCode: "473TS", accountName: "473TS", amount: 100000, taxType: "NONE", description: "" },
    ],
    source: "bank",
    taxBasis: "both",
  });
  const lines = (date) =>
    betweenEntityJournals([journal(date, date)], options)
      .journals.flatMap((j) => j.lines)
      .filter((l) => l.accountName.endsWith("funds introduced"))
      .map((l) => `${l.accountName} ${l.amount}`)
      .sort();
  assert.deepEqual(lines("2025-08-01"), ["Ana: funds introduced -50000", "Tom: funds introduced -50000"]);
  assert.deepEqual(lines("2025-11-01"), ["Ana: funds introduced -70000", "Tom: funds introduced -30000"]);
});

test("a rental schedule uses the shares of the period it covers", () => {
  const schedule = {
    entity: totara,
    income: [{ code: "200", name: "Rent", amount: 1_000_000 }],
    expenses: [],
    totalIncome: 1_000_000,
    totalExpenses: 0,
    net: 1_000_000,
    period: { from: "2024-04-01", to: "2025-03-31" },
  };
  assert.equal(ownerRentalSchedule(schedule, "Ana")?.percent, 50);
  assert.equal(ownerRentalSchedule({ ...schedule, period: { from: "2026-04-01", to: "2027-03-31" } }, "Ana")?.percent, 70);
});

test("one name changed and nothing else is a rename, carried through every entity", () => {
  assert.deepEqual(ownerRenamed(halves, [{ name: "Ana", percent: 50 }, { name: "Thomas", percent: 50 }]), { from: "Tom", to: "Thomas" });
  assert.equal(ownerRenamed(halves, [{ name: "Ana", percent: 40 }, { name: "Thomas", percent: 60 }]), null);
  assert.equal(ownerRenamed(halves, [{ name: "Bea", percent: 50 }, { name: "Thomas", percent: 50 }]), null);
  const model = renameOwnerInModel({ entities: [{ ...totara, holderIrd: { Tom: "123" } }], accounts: {}, banks: {} }, "Tom", "Thomas");
  const [e] = model.entities;
  assert.deepEqual(e.owners.map((o) => o.name), ["Ana", "Thomas"]);
  assert.deepEqual(e.earlierOwners[0].owners.map((o) => o.name), ["Ana", "Thomas"]);
  assert.deepEqual(e.holderIrd, { Thomas: "123" });
});
