import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Key files sealed by the desktop program (review of 27 November): one this
// program cannot open -- sealed under another Windows profile, say -- reads as
// empty, and must be kept aside rather than written over.
const keys = mkdtempSync(join(tmpdir(), "nzosa-sealed-keys-"));
process.env.OSABOOKS_SECRETS = keys;
const dist = mkdtempSync(join(tmpdir(), "nzosa-sealed-dist-"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>t</title>");
process.env.OSABOOKS_DIST = dist;
const { secretFile, startServer } = await import("../server.js");

// A stand-in for Windows' own sealing: this program opens only what it sealed.
const secretBox = {
  seal: (plain) => `mine:${Buffer.from(plain).toString("base64")}`,
  open: (cipher) => {
    if (!cipher.startsWith("mine:")) throw new Error("cannot unseal");
    return Buffer.from(cipher.slice(5), "base64").toString("utf8");
  },
};

const root = mkdtempSync(join(tmpdir(), "nzosa-sealed-books-"));
const running = await startServer({ port: 0, ledgerRoot: root, ledgerId: "test-books", secretBox });
const base = `http://127.0.0.1:${running.port}`;
test.after(() => {
  running.stop();
  for (const folder of [root, keys, dist]) rmSync(folder, { recursive: true, force: true });
});

test("a sealed key file this program cannot open is kept aside, not written over", async () => {
  const file = secretFile(root, ".ai.json");
  mkdirSync(dirname(file), { recursive: true });
  const foreign = JSON.stringify({ v: 1, sealed: "theirs:someone-elses-keys" });
  writeFileSync(file, foreign);

  const response = await fetch(`${base}/api/ai`, { method: "DELETE" });
  assert.equal(response.status, 200);

  const folder = join(file, "..");
  const aside = readdirSync(folder).filter((name) => name.startsWith(".ai.json.unreadable-"));
  assert.equal(aside.length, 1, "the unreadable file is kept, renamed");
  assert.equal(readFileSync(join(folder, aside[0]), "utf8"), foreign, "and unchanged");

  const now = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(now.v, 1);
  assert.ok(now.sealed.startsWith("mine:"), "the new file is sealed by this program");
});

test("a sealed key file this program can open is simply rewritten", async () => {
  const file = secretFile(root, ".ai.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ v: 1, sealed: secretBox.seal(JSON.stringify({ other: { key: "k" } })) }));
  const before = readdirSync(join(file, "..")).filter((name) => name.includes("unreadable")).length;

  const response = await fetch(`${base}/api/ai`, { method: "DELETE" });
  assert.equal(response.status, 200);

  assert.equal(readdirSync(join(file, "..")).filter((name) => name.includes("unreadable")).length, before, "nothing more set aside");
  const kept = JSON.parse(secretBox.open(JSON.parse(readFileSync(file, "utf8")).sealed));
  assert.deepEqual(kept, { other: { key: "k" } }, "other books' keys kept");
});
