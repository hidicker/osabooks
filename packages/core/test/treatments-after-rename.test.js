import assert from "node:assert/strict";
import test from "node:test";
import { treatmentsAfterRename } from "../dist/index.js";

// GST treatments are held by account label. When chart import gives an unused
// account the file's name, its treatment has to move to the new label, or the
// account loses it and falls back to the default.

test("a plain label moves to the new name", () => {
  const held = { "Sales - 200": "15% GST on Income", "Rent - 400": "15% GST on Expenses" };
  assert.deepEqual(treatmentsAfterRename(held, [{ code: "200", name: "Tandem flights" }]), {
    "Tandem flights - 200": "15% GST on Income",
    "Rent - 400": "15% GST on Expenses",
  });
});

test("a house-prefixed label keeps its prefix", () => {
  const held = { "NB Sales - 200": "15% GST on Income" };
  assert.deepEqual(treatmentsAfterRename(held, [{ code: "200", name: "Tandem flights" }]), {
    "NB Tandem flights - 200": "15% GST on Income",
  });
});

test("a treatment already held under the new label is kept, and the old label goes", () => {
  const held = { "Sales - 200": "Zero Rated", "Tandem flights - 200": "15% GST on Income" };
  assert.deepEqual(treatmentsAfterRename(held, [{ code: "200", name: "Tandem flights" }]), {
    "Tandem flights - 200": "15% GST on Income",
  });
});

test("other codes, a code-less account and nothing renamed change nothing", () => {
  const held = { "Sales - 200": "15% GST on Income", "Sales - 2000": "Zero Rated" };
  assert.deepEqual(treatmentsAfterRename(held, [{ code: "300", name: "Other" }]), held);
  assert.deepEqual(treatmentsAfterRename(held, [{ code: "", name: "Other" }]), held);
  assert.deepEqual(treatmentsAfterRename(held, []), held);
  assert.notEqual(treatmentsAfterRename(held, []), held, "a new object, the old one untouched");
});
