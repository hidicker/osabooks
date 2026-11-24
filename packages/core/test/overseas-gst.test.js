import assert from "node:assert/strict";
import test from "node:test";
import { businessOf, chargesNzGst, knownBusinessNames, overseasGstNames } from "../dist/index.js";

test("every overseas business said to charge NZ GST is on the known-business list", () => {
  // A name here that the list does not have would never match a line.
  const known = new Set(knownBusinessNames());
  for (const name of overseasGstNames()) assert.ok(known.has(name.toUpperCase()), `${name} is not on the list`);
});

test("a line with a business known to charge NZ GST is found; others are not known", () => {
  const line = (otherParty) => ({ otherParty, particulars: "", code: "", reference: "" });
  const netflix = businessOf(line("NETFLIX.COM LOS GATOS NZD22"), "nz");
  assert.equal(netflix?.name, "Netflix");
  assert.equal(chargesNzGst(netflix.name), true);
  const temu = businessOf(line("TEMU COM AUCKLAND NZD4200"), "nz");
  assert.equal(chargesNzGst(temu.name), true);
  // On the known-business list, but not known to charge NZ GST: left to the receipt.
  const wise = businessOf(line("WISE"), "nz");
  assert.equal(chargesNzGst(wise.name), false);
  assert.equal(businessOf(line("DEEPSEERWEA 18658850911 USD1060"), "nz"), null);
});
