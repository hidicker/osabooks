import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Undoing a batch of codings: refused only when a later change touched one of
 * its lines, not because some other batch came later.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-history-"));
const bundle = join(out, "events.mjs");
await build({
  entryPoints: [join(root, "src", "events.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const { canReverse } = await import(pathToFileURL(bundle).href);

const batch = (id, lines) => ({
  id, at: id, who: "unattributed", kind: "codingBatch", summary: "batch",
  before: lines.map((line) => ({ id: line, before: { code: "620HD", confirmed: true } })),
  after: null,
});
const coding = (id, line) => ({
  id, at: id, who: "unattributed", kind: "coding", targetId: line, summary: "one", before: null, after: null,
});

test("a later batch on other lines does not block undoing an earlier one", () => {
  const early = batch("2026-10-06T09:10:13.213Z-0001", ["a", "b"]);
  const later = batch("2026-10-14T01:33:57.534Z-0001", ["c", "d"]);
  assert.deepEqual(canReverse([later, early], early), { ok: true });
});

test("a later batch sharing a line blocks it", () => {
  const early = batch("2026-10-06T09:10:13.213Z-0001", ["a", "b"]);
  const later = batch("2026-10-14T01:33:57.534Z-0001", ["b", "c"]);
  assert.equal(canReverse([later, early], early).ok, false);
});

test("a later coding of one of its lines blocks it", () => {
  const early = batch("2026-10-06T09:10:13.213Z-0001", ["a", "b"]);
  const later = coding("2026-10-07T00:00:00.000Z-0001", "a");
  assert.equal(canReverse([later, early], early).ok, false);
  const elsewhere = coding("2026-10-07T00:00:00.000Z-0002", "z");
  assert.deepEqual(canReverse([elsewhere, early], early), { ok: true });
});

test("an undone batch cannot be undone again", () => {
  const early = { ...batch("2026-10-06T09:10:13.213Z-0001", ["a"]), reverted: true };
  assert.equal(canReverse([early], early).ok, false);
});

test("a later change made on a computer whose clock is behind still blocks Undo", () => {
  // Newest first in History: the second change was made after the first, on a
  // computer whose clock says it was earlier.
  const first = coding("2026-10-07T10:00:00.000Z-0001", "a");
  const second = coding("2026-10-07T09:55:00.000Z-0001", "a");
  assert.equal(canReverse([second, first], first).ok, false);
  assert.deepEqual(canReverse([second, first], second), { ok: true });
});
