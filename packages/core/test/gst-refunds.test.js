import assert from "node:assert/strict";
import test from "node:test";
import { gstContent, gstReturn, signedBox15 } from "../dist/index.js";

// Code review 2026-11-20, 11: in a period whose refunds outweigh its trading,
// Box 5 or Box 11 came out negative, a return Inland Revenue and the Pro
// filing service refuse. Net refunds belong in Box 13 (to customers) and
// Box 9 (from suppliers), with Box 15 unchanged.

const period = { from: "2026-10-01", to: "2026-11-30", label: "Oct-Nov", due: "2027-01-15" };
const line = (id, amount) => ({
  id, date: "2026-10-15", amount, currency: "NZD", account: "b", otherParty: "", particulars: "", code: "", reference: "",
  extras: {}, source: { file: "f", line: 1 },
});
const returnOf = (lines, sides, rounding = "per-line", treatment = () => "standard") =>
  gstReturn(lines, period, { basis: "payments", rounding, refundsAsAdjustments: true, resolve: (t) => ({ treatment: treatment(t), side: sides[t.id] }) });

/** The arithmetic the filing service checks (osabooks-pro pro/filing/src/gst-filing.ts filingProblems). */
function filingProblems(b) {
  const p = [];
  if (b.box5 < 0) p.push("box5 negative");
  if (b.box6 < 0) p.push("box6 negative");
  if (b.box11 < 0) p.push("box11 negative");
  if (b.box6 > b.box5) p.push("box6 more than box5");
  if (b.box7 !== b.box5 - b.box6) p.push("box7");
  if (Math.abs(b.box8 - gstContent(b.box7)) > 1) p.push("box8");
  if (b.box10 !== b.box8 + b.box9) p.push("box10");
  if (Math.abs(b.box12 - gstContent(b.box11)) > 1) p.push("box12");
  if (b.box14 !== b.box12 + b.box13) p.push("box14");
  if (b.box15 !== Math.abs(b.box10 - b.box14)) p.push("box15");
  const outcome = b.box10 > b.box14 ? "pay" : b.box10 < b.box14 ? "refund" : "nil";
  if (b.outcome !== outcome) p.push("outcome");
  return p;
}

test("refunds to customers outweighing sales go in Box 13, and Box 15 is unchanged", () => {
  // A 1,150 sale (150 GST) and a 5,750 refund (750 GST): 600 of GST back.
  const r = returnOf([line("s", 115_000), line("r", -575_000)], { s: "sales", r: "sales" });
  assert.equal(r.boxes.box5, 0);
  assert.equal(r.boxes.box8, 0);
  assert.equal(r.boxes.box13, 60_000);
  assert.equal(signedBox15(r.boxes), -60_000, "a refund of the 600 of GST, as before");
  assert.deepEqual(r.refundsMoved, { toBox13: 60_000, toBox9: 0 });
  assert.deepEqual(filingProblems(r.boxes), []);
});

test("refunds from suppliers outweighing purchases go in Box 9", () => {
  const r = returnOf([line("p", -23_000), line("back", 115_000)], { p: "purchases", back: "purchases" });
  assert.equal(r.boxes.box11, 0);
  assert.equal(r.boxes.box12, 0);
  assert.equal(r.boxes.box9, 12_000);
  assert.equal(signedBox15(r.boxes), 12_000, "the 120 of GST claimed back is paid back");
  assert.deepEqual(filingProblems(r.boxes), []);
});

test("without the GST101A's rule nothing moves: a BAS and a Korean return read the boxes as they are", () => {
  const r = gstReturn([line("s", 115_000), line("r", -575_000)], period, {
    basis: "payments",
    resolve: () => ({ treatment: "standard", side: "sales" }),
  });
  assert.equal(r.boxes.box5, -460_000);
  assert.equal(r.boxes.box13, 0);
  assert.equal(r.refundsMoved, undefined);
});

test("an ordinary period moves nothing", () => {
  const r = returnOf([line("s", 115_000), line("p", -23_000)], { s: "sales", p: "purchases" });
  assert.equal(r.refundsMoved, undefined);
  assert.equal(r.boxes.box5, 115_000);
  assert.equal(r.boxes.box11, 23_000);
});

test("every return the core makes passes the filing service's checks, and Box 15 is what it was", () => {
  let seed = 3;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3_000; i++) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 60) }, (_, k) => line(`t${k}`, (next() < 0.5 ? 1 : -1) * (1 + Math.floor(next() * 300_000))));
    const sides = Object.fromEntries(lines.map((t) => [t.id, next() < 0.85 ? (t.amount > 0 ? "sales" : "purchases") : t.amount > 0 ? "purchases" : "sales"]));
    const treat = Object.fromEntries(lines.map((t) => [t.id, ["standard", "standard", "standard", "zero-rated", "exempt"][Math.floor(next() * 5)]]));
    for (const rounding of ["per-line", "form"]) {
      const r = returnOf(lines, sides, rounding, (t) => treat[t.id]);
      assert.deepEqual(filingProblems(r.boxes), [], `case ${i}, ${rounding}`);
      if (rounding !== "per-line") continue;
      // What is paid or refunded is the period's GST, worked here from the
      // lines themselves: moving the refunds only changes the boxes it is in.
      const gst = (side) =>
        lines
          .filter((t) => sides[t.id] === side && treat[t.id] === "standard")
          .reduce((s, t) => s + gstContent(side === "sales" ? t.amount : -t.amount), 0);
      assert.equal(signedBox15(r.boxes), gst("sales") - gst("purchases"), `case ${i}: Box 15`);
    }
  }
});
