import assert from "node:assert/strict";
import test from "node:test";
import { overrideSaid, separateCodingNote, separateCodingNotes } from "../dist/index.js";

test("the app's own words move out of the note; a person's stay", () => {
  assert.deepEqual(separateCodingNote({ note: "Suggestion accepted unchanged" }), { note: "", how: "accepted" });
  assert.deepEqual(separateCodingNote({ note: "Changed by hand, no description given" }), { note: "", how: "changed" });
  assert.deepEqual(separateCodingNote({ note: "Suggestion accepted unchanged, with others" }), { note: "", how: "accepted-all" });
  assert.deepEqual(separateCodingNote({ note: "Suggestion confirmed unchanged" }), { note: "", how: "accepted" });
  const ai = separateCodingNote({ note: "AI suggestion accepted unchanged, with others (Claude) — 92% sure: power bill" });
  assert.equal(ai.how, "ai");
  assert.equal(ai.note, "");
  assert.equal(ai.why, "92% sure: power bill");
  const own = { note: "Shared with Alex, see email" };
  assert.equal(separateCodingNote(own), own);
});

test("what is said: the note when there is one, otherwise how", () => {
  assert.equal(overrideSaid({ note: "Client lunch", how: "changed" }), "Client lunch");
  assert.equal(overrideSaid({ note: "", how: "changed" }), "Changed by hand");
  assert.equal(overrideSaid({ note: "", how: "ai", why: "92% sure: power bill" }), "AI suggestion accepted unchanged, with others — 92% sure: power bill");
  assert.equal(overrideSaid({ note: "" }), "");
});

test("books with nothing to move come back as the same object", () => {
  const overrides = { a: { note: "Mine" } };
  assert.equal(separateCodingNotes(overrides), overrides);
  const moved = separateCodingNotes({ a: { note: "Suggestion accepted unchanged", code: "400" } });
  assert.deepEqual(moved, { a: { note: "", how: "accepted", code: "400" } });
});
