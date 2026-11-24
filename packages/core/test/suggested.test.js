import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSuggestedSet,
  connectedAppLabel,
  knownApp,
  readSuggestedFile,
  returnHost,
  suggestedSetId,
  suggesterName,
  suggestionKey,
  suggestionsWaiting,
  SUGGESTED_SETS_KEPT,
} from "../dist/index.js";

const fuel = { kind: "coding", transaction: "t1", code: "Motor Vehicle Expenses - 449", because: "fuel" };
const rent = { kind: "coding", transaction: "t2", code: "Rent - 469", because: "landlord" };

test("a set is named by what is in it, and the same set is kept once", () => {
  assert.equal(suggestedSetId([fuel]), suggestedSetId([{ ...fuel }]));
  assert.notEqual(suggestedSetId([fuel]), suggestedSetId([rent]));
  const first = addSuggestedSet(readSuggestedFile(undefined), [fuel], "claude-ai", "2026-10-31T09:00:00Z");
  assert.equal(first.already, false);
  const again = addSuggestedSet(first.file, [fuel], "claude-ai", "2026-10-31T09:05:00Z");
  assert.equal(again.already, true);
  assert.equal(again.file.sets.length, 1);
  assert.equal(again.set.at, "2026-10-31T09:00:00Z");
});

test("newest first, and only so many kept", () => {
  let file = readSuggestedFile({ sets: [] });
  for (let i = 0; i < SUGGESTED_SETS_KEPT + 5; i++) {
    file = addSuggestedSet(file, [{ ...fuel, because: `n${i}` }], "x", `t${i}`).file;
  }
  assert.equal(file.sets.length, SUGGESTED_SETS_KEPT);
  assert.equal(file.sets[0].items[0].because, `n${SUGGESTED_SETS_KEPT + 4}`);
});

test("waiting leaves out what was used, declined or passed over, oldest first", () => {
  const a = addSuggestedSet(readSuggestedFile(null), [fuel, rent], "x", "1");
  const b = addSuggestedSet(a.file, [{ ...rent, because: "again" }], "x", "2");
  const waiting = suggestionsWaiting(b.file, { [suggestionKey(a.set.id, 0)]: "used" });
  assert.deepEqual(waiting.map((w) => w.item.because), ["landlord", "again"]);
});

test("a file that is not one is read as empty", () => {
  assert.deepEqual(readSuggestedFile("nonsense"), { version: 1, sets: [] });
  assert.deepEqual(readSuggestedFile({ sets: [null, { items: [] }] }).sets.length, 1);
});

test("the app is named as a person would name it", () => {
  assert.equal(suggesterName("claude-ai"), "Claude");
  assert.equal(suggesterName("Claude Desktop"), "Claude");
  assert.equal(suggesterName("cursor-vscode"), "Cursor");
  assert.equal(suggesterName(""), "your AI app");
});

test("an online app is known by where it returns to, not by its name (code review 4.1)", () => {
  // Claude's own connector, as seen on the live project.
  assert.equal(knownApp("https://claude.ai/api/mcp/auth_callback"), "Claude");
  assert.equal(knownApp("https://chatgpt.com/connector_platform_oauth_redirect"), "ChatGPT");
  // A look-alike host, plain http, or no address is not known.
  for (const other of ["https://claude.ai.evil.example/cb", "https://evilclaude.ai/cb", "http://claude.ai/cb", "not a url", undefined]) {
    assert.equal(knownApp(other), null, String(other));
  }
  assert.equal(returnHost("https://evilclaude.ai/cb?x=1"), "evilclaude.ai");
  assert.equal(returnHost("http://claude.ai/cb"), "http://claude.ai");
  assert.equal(returnHost("javascript:alert(1)"), null);

  assert.equal(connectedAppLabel("Claude", ["https://claude.ai/api/mcp/auth_callback"]), "Claude");
  assert.equal(connectedAppLabel("Claude", ["https://claude.ai/cb", "https://claude.com/cb"]), "Claude");
  // Mixed redirect URIs (one Claude, one attacker): never labelled Claude (Antigravity review H1).
  assert.equal(
    connectedAppLabel("Claude", ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"]),
    "Claude (unverified)",
  );
  // Calling itself Claude, returning elsewhere: its own name, marked, and never shown as Claude.
  const fake = connectedAppLabel("claude-helper", ["https://evil.example/cb"]);
  assert.equal(fake, "claude-helper (unverified)");
  assert.equal(suggesterName(fake), "claude-helper (unverified)");
  assert.equal(connectedAppLabel("", ["http://localhost:9/cb"]), "An AI app (unverified)");
  assert.equal(connectedAppLabel("Claude", []), "Claude (unverified)");
});
