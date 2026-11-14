import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The keys to bank feeds and AI, in a folder of the test's own rather than
// the real one on this computer.
const keys = mkdtempSync(join(tmpdir(), "nzosa-keys-"));
process.env.OSABOOKS_SECRETS = keys;
const { secretFile, startServer } = await import("../server.js");

/**
 * The local server's answers to requests it should refuse: a body that is not
 * JSON and a malformed % escape are the asker's fault (400, not 500), pages
 * may not be framed, and the two GETs that fetch from the bank refuse a
 * cross-site request.
 */
const root = mkdtempSync(join(tmpdir(), "nzosa-server-"));
const running = await startServer({ port: 0, ledgerRoot: root, ledgerId: "test-books" });
const base = `http://127.0.0.1:${running.port}`;
test.after(() => {
  running.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
});

test("a body that is not JSON is a 400", async () => {
  const response = await fetch(`${base}/api/ledger/parts/decisions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
});

test("a malformed % escape is a 400", async () => {
  const response = await fetch(`${base}/%E0%A4%A`);
  assert.equal(response.status, 400);
});

test("pages may not be framed, and run only the app's own scripts", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const policy = response.headers.get("content-security-policy");
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  // The page's inline script, allowed by its hash and nothing looser.
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'(;|$)/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe/);
  // JSON answers keep the short policy: they are not pages.
  const api = await fetch(`${base}/api/status`);
  assert.equal(api.headers.get("content-security-policy"), "frame-ancestors 'none'");
});

test("the bank fetches refuse a cross-site request, and allow one with no Sec-Fetch-Site", async () => {
  for (const path of ["/api/feed/transactions", "/api/wise/statement"]) {
    const cross = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(cross.status, 403, path);
    const same = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(same.status, 400, `${path}: on to "not connected"`);
    const none = await fetch(`${base}${path}`);
    assert.equal(none.status, 400, `${path}: on to "not connected"`);
  }
});

test("a key file beside the books moves to OsaBooks's own folder, not left to be synced", () => {
  // A books folder in OneDrive or Dropbox was copied to that cloud with the
  // bank feed's and the AI's keys in it.
  const books = mkdtempSync(join(tmpdir(), "nzosa-books-"));
  try {
    writeFileSync(join(books, ".ai.json"), '{"main":{"key":"sk-test"}}');
    const file = secretFile(books, ".ai.json");
    assert.ok(file.startsWith(keys), file);
    assert.equal(readFileSync(file, "utf8"), '{"main":{"key":"sk-test"}}');
    assert.equal(existsSync(join(books, ".ai.json")), false, "gone from beside the books");
    assert.equal(secretFile(books, ".ai.json"), file, "the same place next time");
  } finally {
    rmSync(books, { recursive: true, force: true });
  }
});

test("no read under /api/ answers another site's page, and attachments are never sniffed", async () => {
  const put = await fetch(`${base}/api/attachments/att-0000test`, { method: "PUT", body: "<script>alert(1)</script>" });
  assert.equal(put.status, 200);
  for (const path of ["/api/ledger", "/api/attachments/att-0000test", "/api/status"]) {
    for (const site of ["cross-site", "same-site"]) {
      const refused = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": site } });
      assert.equal(refused.status, 403, `${path} from ${site}`);
    }
    const own = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(own.status, 200, `${path} from the app itself`);
    const typed = await fetch(`${base}${path}`);
    assert.equal(typed.status, 200, `${path} with no header`);
  }
  const file = await fetch(`${base}/api/attachments/att-0000test`);
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.equal(file.headers.get("content-type"), "application/octet-stream");
});
