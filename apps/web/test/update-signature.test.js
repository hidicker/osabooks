import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The desktop program's own update signature (desktop/update-signature.cjs):
// an update installs only if the publisher's key signed this file, this
// version. Plain Node, so tested here with the rest.
const require = createRequire(import.meta.url);
const { makeKeyPair, signUpdate, verifyUpdate } = require("../../../desktop/update-signature.cjs");

const folder = mkdtempSync(join(tmpdir(), "osabooks-update-sig-"));
test.after(() => rmSync(folder, { recursive: true, force: true }));
const installer = join(folder, "OsaBooks-Setup.exe");
writeFileSync(installer, Buffer.from("an installer, standing in"));
const mine = makeKeyPair();
const theirs = makeKeyPair();

test("an update signed with the publisher's key checks out", async () => {
  const signature = await signUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", mine.privatePem);
  assert.equal(await verifyUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", signature, mine.publicKey), true);
});

test("anyone else's key, another version, another name or a changed file does not", async () => {
  const signature = await signUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", mine.privatePem);
  const forged = await signUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", theirs.privatePem);
  assert.equal(await verifyUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", forged, mine.publicKey), false, "signed by someone else");
  assert.equal(await verifyUpdate(installer, "OsaBooks-Setup.exe", "2026.1201.0", signature, mine.publicKey), false, "moved to another version");
  assert.equal(await verifyUpdate(installer, "Other-Setup.exe", "2026.1128.0", signature, mine.publicKey), false, "moved to another file");
  const changed = join(folder, "changed.exe");
  writeFileSync(changed, Buffer.from("an installer, standing in, changed"));
  assert.equal(await verifyUpdate(changed, "OsaBooks-Setup.exe", "2026.1128.0", signature, mine.publicKey), false, "a changed file");
});

test("a missing or malformed signature or key is a no, never an error", async () => {
  for (const [signature, key] of [["", mine.publicKey], [undefined, mine.publicKey], ["not base64!", mine.publicKey], ["AAAA", ""], ["AAAA", "not a key"]]) {
    assert.equal(await verifyUpdate(installer, "OsaBooks-Setup.exe", "2026.1128.0", signature, key), false);
  }
  assert.equal(await verifyUpdate(join(folder, "missing.exe"), "OsaBooks-Setup.exe", "2026.1128.0", "AAAA", mine.publicKey), false);
});
