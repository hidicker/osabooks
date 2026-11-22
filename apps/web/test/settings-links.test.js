import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Settings sends people to the page each setting lives on. A link naming a
 * page the app does not have does nothing when pressed, with nothing to say
 * why; and a feature added since Settings last changed is simply not there.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const settings = readFileSync(join(root, "src", "daily", "settings-page.ts"), "utf8");
const page = readFileSync(join(root, "public", "index.html"), "utf8");
const pages = new Set([...page.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]));

test("every page Settings links to is a page of the app", () => {
  const linked = [...settings.matchAll(/page: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(linked.length > 10, "Settings links to pages");
  const missing = linked.filter((p) => !pages.has(p));
  assert.deepEqual(missing, [], `Settings links to pages that do not exist: ${missing.join(", ")}`);
});

test("Settings names the features added since it was laid out", () => {
  for (const name of ["Where the books are kept", "Two-factor sign-in", "Bank feeds", "AI", "Backup and exporting", "Reminders", "Lock dates", "Time zone"]) {
    assert.match(settings, new RegExp(`name: "${name}"`), `no "${name}" row`);
  }
});
