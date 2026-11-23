import assert from "node:assert/strict";
import test from "node:test";
import {
  gstFilers,
  gstReturn,
  registrationIrd,
  renameOwnerInModel,
  sameRegistration,
} from "../dist/index.js";

/**
 * Co-owners of a property who each register for GST for their own share and
 * file a return each: the property's return split by owner, each filed under
 * the owner's own GST number.
 */

const larch = {
  id: "larch",
  name: "Larch Street",
  gstByOwners: true,
  owners: [{ name: "Hamish", percent: 50 }, { name: "Jaehee", percent: 50 }],
  ownerGstNumbers: { Hamish: "49-091-850", Jaehee: " " },
};

test("each owner files for their share, under their own number where given", () => {
  assert.deepEqual(gstFilers(larch, "2026-05-31"), [
    { owner: "Hamish", percent: 50, gstNumber: "49-091-850" },
    { owner: "Jaehee", percent: 50 },
  ]);
});

test("one return of its own: not by owners, or only one owner", () => {
  assert.deepEqual(gstFilers({ ...larch, gstByOwners: false }, "2026-05-31"), []);
  assert.deepEqual(gstFilers({ ...larch, owners: [{ name: "Hamish", percent: 100 }] }, "2026-05-31"), []);
  assert.deepEqual(gstFilers({ ...larch, gstByOwners: undefined }, "2026-05-31"), []);
});

test("the shares on the period's last day, where they changed", () => {
  const changed = { ...larch, owners: [{ name: "Hamish", percent: 60 }, { name: "Jaehee", percent: 40 }], earlierOwners: [{ until: "2026-03-31", owners: larch.owners }] };
  assert.equal(gstFilers(changed, "2026-03-31")[0].percent, 50);
  assert.equal(gstFilers(changed, "2026-05-31")[0].percent, 60);
});

test("an owner renamed keeps their GST number", () => {
  const model = renameOwnerInModel({ entities: [larch], accounts: {}, banks: {} }, "Hamish", "Hamish Dicker");
  assert.deepEqual(model.entities[0].ownerGstNumbers, { "Hamish Dicker": "49-091-850", Jaehee: " " });
});

test("a registration is the same however it is written", () => {
  assert.equal(registrationIrd("049-091-850-GST001"), "49091850");
  assert.equal(registrationIrd("49-091-850"), "49091850");
  assert.equal(registrationIrd(undefined), "");
  assert.equal(sameRegistration("049-091-850-GST001", "49-091-850"), true);
  assert.equal(sameRegistration("49091850", "49-091-850"), true);
  assert.equal(sameRegistration(undefined, undefined), true);
  assert.equal(sameRegistration(undefined, "49-091-850"), false);
  assert.equal(sameRegistration("49-091-850", "123-456-789"), false);
  // Two GST accounts under one IRD number are two registrations.
  assert.equal(sameRegistration("049-091-850-GST001", "049-091-850-GST002"), false);
  assert.equal(sameRegistration("049-091-850-gst001", "049-091-850-GST001"), true);
});

test("each owner's return is their share of every line, and adds up as the form does", () => {
  const lines = [
    { id: "r1", date: "2026-04-10", amount: 287_501, description: "rent", account: "a", extras: {} },
    { id: "r2", date: "2026-05-10", amount: 287_501, description: "rent", account: "a", extras: {} },
    { id: "p1", date: "2026-04-20", amount: -115_003, description: "repairs", account: "a", extras: {} },
  ];
  const resolve = (t) => ({ side: t.amount > 0 ? "sales" : "purchases", treatment: "standard" });
  const period = { from: "2026-04-01", to: "2026-05-31", label: "2026-05", due: "2026-06-28" };
  const whole = gstReturn(lines, period, { resolve, basis: "payments", refundsAsAdjustments: true });
  const half = gstReturn(lines, period, { resolve, basis: "payments", sharePercent: 50, refundsAsAdjustments: true });
  for (const r of [whole, half]) {
    const b = r.boxes;
    assert.equal(b.box7, b.box5 - b.box6);
    assert.equal(b.box10, b.box8 + b.box9);
    assert.equal(b.box14, b.box12 + b.box13);
    assert.equal(b.box15, Math.abs(b.box10 - b.box14));
  }
  assert.equal(half.sharePercent, 50);
  // Two halves come within a cent a line of the whole.
  assert.ok(Math.abs(2 * half.boxes.box15 - whole.boxes.box15) <= lines.length * 2);
});
