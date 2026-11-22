import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * A reload that comes back to its page. Giving a two-factor code on the Books
 * page reloaded the app onto Reconcile, with nothing said: it now comes back
 * to the Books page and says the code worked.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-reload-onto-"));
const bundle = join(out, "reload-onto.mjs");
await build({ entryPoints: [join(root, "src", "reload-onto.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
test.after(() => rmSync(out, { recursive: true, force: true }));
const { reloadOnto, pageAfterReload } = await import(pathToFileURL(bundle).href);

function fakeTab() {
  const held = new Map();
  let reloads = 0;
  globalThis.sessionStorage = {
    getItem: (k) => (held.has(k) ? held.get(k) : null),
    setItem: (k, v) => held.set(k, String(v)),
    removeItem: (k) => held.delete(k),
  };
  globalThis.location = { reload: () => { reloads += 1; } };
  return { held, reloads: () => reloads };
}

test("the page and what to say come back once, after the reload", () => {
  const tab = fakeTab();
  reloadOnto("books", "Code accepted. Your books are open.");
  assert.equal(tab.reloads(), 1);
  assert.deepEqual(pageAfterReload(), { page: "books", message: "Code accepted. Your books are open." });
  assert.equal(pageAfterReload(), null, "read once");
});

test("nothing asked, nothing changed; and anything unreadable is ignored", () => {
  const tab = fakeTab();
  assert.equal(pageAfterReload(), null);
  tab.held.set("nzosa:reload-onto", "not json");
  assert.equal(pageAfterReload(), null);
  tab.held.set("nzosa:reload-onto", JSON.stringify({ page: "" }));
  assert.equal(pageAfterReload(), null);
  reloadOnto("settings");
  assert.deepEqual(pageAfterReload(), { page: "settings" });
});

test("a browser that keeps nothing still reloads, and opens where it usually does", () => {
  globalThis.sessionStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  let reloaded = false;
  globalThis.location = { reload: () => { reloaded = true; } };
  reloadOnto("books");
  assert.equal(reloaded, true);
  assert.equal(pageAfterReload(), null);
});

test("a two-factor code given comes back to the Books page", () => {
  const ui = readFileSync(join(root, "src", "daily", "two-factor-ui.ts"), "utf8");
  assert.match(ui, /reloadOnto\("books"/);
});
