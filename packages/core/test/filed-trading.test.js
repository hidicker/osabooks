import assert from "node:assert/strict";
import test from "node:test";
import { filedByPeriod, filedDifference, filedReturnFromBoxes, filedReturnFromOurs, gstBoxesFrom, gstReturn, tradingGst } from "../dist/index.js";

// Antigravity review M4: in a period whose refunds outweigh its sales, the
// refunds' GST moves to Box 13 and Box 8 is 0, so Box 8 less Box 12 stayed
// the same whatever the refunds came to, and the books "still agreed with the
// return as filed" after a refund was changed. A return filed from these books
// is now compared on its GST before the refunds were moved.

const period = { from: "2026-10-01", to: "2026-11-30", label: "Oct-Nov", due: "2027-01-15" };
const line = (id, amount) => ({
  id, date: "2026-10-15", amount, currency: "NZD", account: "b", otherParty: "", particulars: "", code: "", reference: "",
  extras: {}, source: { file: "f", line: 1 },
});
const sideOf = { s: "sales", r: "sales", p: "purchases", back: "purchases" };
const returnOf = (lines) =>
  gstReturn(lines, period, { basis: "payments", refundsAsAdjustments: true, resolve: (t) => ({ treatment: "standard", side: sideOf[t.id] }) });

test("a refund changed after filing, in a net-refund period, is a difference", () => {
  // A 1,150 sale (150 GST) and a 5,750 refund (750 GST), and a 460 purchase (60 GST).
  const filedThen = returnOf([line("s", 115_000), line("r", -575_000), line("p", -46_000)]);
  assert.equal(filedThen.boxes.box8, 0, "the refunds outweigh the sales");
  const filed = filedReturnFromOurs(filedThen);
  assert.equal(filed.core, -6_000, "Box 8 less Box 12");
  assert.equal(filed.trading, -66_000, "150 less 750 less 60 of GST");

  // The refund was 6,900 (900 GST), not 5,750.
  const now = returnOf([line("s", 115_000), line("r", -690_000), line("p", -46_000)]);
  assert.equal(now.boxes.box8 - now.boxes.box12, filed.core, "Box 8 less Box 12 alone does not see it");
  assert.deepEqual(filedDifference(filed, now), { filed: -66_000, ours: -81_000, difference: -15_000 });

  assert.equal(filedDifference(filed, filedThen).difference, 0, "unchanged books agree");
});

test("a refund from a supplier changed after filing is a difference too", () => {
  const filedThen = returnOf([line("s", 230_000), line("p", -23_000), line("back", 115_000)]);
  assert.equal(filedThen.boxes.box12, 0);
  const filed = filedReturnFromOurs(filedThen);
  const now = returnOf([line("s", 230_000), line("p", -23_000), line("back", 172_500)]);
  assert.equal(filedDifference(filed, now).difference, 7_500, "75 more of GST to pay back");
});

test("in an ordinary period the figure is Box 8 less Box 12, as before", () => {
  const r = returnOf([line("s", 115_000), line("p", -23_000)]);
  const filed = filedReturnFromOurs(r);
  assert.equal(filed.trading, filed.core);
  assert.equal(tradingGst(r), r.boxes.box8 - r.boxes.box12);
});

test("a return from elsewhere is compared on Box 8 less Box 12, its own Box 13 left alone", () => {
  // Typed from myIR: Box 13 carries a correction these books cannot know.
  const typed = filedReturnFromBoxes({
    periodStart: period.from, periodEnd: period.to, basis: "Payments basis", status: "Filed",
    boxes: gstBoxesFrom({ box5: 0, box6: 0, box9: 0, box11: 46_000, box13: 60_000 }),
  });
  assert.equal(typed.trading, undefined);
  const now = returnOf([line("s", 115_000), line("r", -575_000), line("p", -46_000)]);
  assert.deepEqual(filedDifference(typed, now), { filed: -6_000, ours: -6_000, difference: 0 });
});

test("returns saved before this change, with no trading figure, compare as they always did", () => {
  const then = returnOf([line("s", 115_000), line("r", -575_000), line("p", -46_000)]);
  const { trading: _gone, ...saved } = filedReturnFromOurs(then);
  assert.equal(filedDifference(saved, then).difference, 0);
});

test("co-owners' returns add their trading figures only when every one has one", () => {
  const r = returnOf([line("s", 115_000), line("r", -575_000), line("p", -46_000)]);
  const a = { ...filedReturnFromOurs(r), registration: "1" };
  const b = { ...filedReturnFromOurs(r), registration: "2" };
  assert.equal(filedByPeriod([a, b])[0].trading, -132_000);
  const { trading: _gone, ...old } = b;
  assert.equal(filedByPeriod([a, old])[0].trading, undefined);
  assert.equal("trading" in filedByPeriod([a, old])[0], false);
});
