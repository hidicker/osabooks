import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Every field of the books survives a save and a reopen.
 *
 * The books are saved in pieces, and the decisions piece is written from a
 * list of named fields. A field added to the books and not to that list works
 * while the app is open and is erased by the next save. This reads the fields
 * from the books' own type, fills every one, writes the pieces and reads them
 * back, so a field added later is checked without anybody remembering to.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-fields-"));
const entry = join(out, "entry.ts");
writeFileSync(entry, `export { ledgerFromParts, ledgerToParts } from ${JSON.stringify(join(root, "src", "store.ts").replace(/\\/g, "/"))};\n`);
const bundle = join(out, "store.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));

/** The fields of StoredLedger, with whether each is a plain true/false. */
function ledgerFields() {
  const source = readFileSync(join(root, "src", "store.ts"), "utf8");
  const start = source.indexOf("export interface StoredLedger {");
  assert.ok(start >= 0, "StoredLedger is in store.ts");
  let depth = 0;
  let end = start;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(source.indexOf("{", start) + 1, end);
  // Only the interface's own fields: two spaces in, not those of a nested type.
  const fields = [];
  for (const match of body.matchAll(/^ {2}([a-zA-Z]+)\??: ([^;\n]+)/gm)) {
    fields.push({ name: match[1], boolean: /^boolean\b/.test(match[2].trim()) });
  }
  return fields;
}

/** Fields read inside when saved, given a shape that has what is read. */
const SHAPES = {
  auPayroll: { employees: [{ marked: "auPayroll" }], payRuns: [] },
  usPayroll: { employer: { state: "CA" }, employees: [{ marked: "usPayroll" }], payRuns: [] },
  payroll: { employerIrd: "", employees: [{ marked: "payroll" }], payRuns: [] },
  classes: { names: ["marked"], assigned: { a: "marked" } },
  jobs: { jobs: [{ marked: "jobs" }], assigned: { a: "marked" } },
  entities: { entities: [{ id: "e1", name: "Marked Ltd" }], accounts: { "200": "e1" }, banks: { b1: ["e1"] } },
};

/** Fields kept in memory only, on purpose, with why. None today. */
const NOT_SAVED = new Map([]);

test("every field of the books comes back after a save", async () => {
  const { ledgerFromParts, ledgerToParts } = await import(pathToFileURL(bundle).href);
  const fields = ledgerFields();
  assert.ok(fields.length > 50, `found ${fields.length} fields`);
  const ledger = { version: 1, transactions: [] };
  for (const { name, boolean } of fields) {
    if (name === "version" || name === "transactions") continue;
    ledger[name] = SHAPES[name] ?? (boolean ? true : [{ marked: name }]);
  }
  const back = ledgerFromParts(ledgerToParts(ledger));
  const lost = fields
    .map((f) => f.name)
    .filter((name) => name !== "version" && name !== "transactions" && !NOT_SAVED.has(name))
    .filter((name) => JSON.stringify(back[name]) !== JSON.stringify(ledger[name]));
  assert.deepEqual(lost, [], `lost on a save and a reopen: ${lost.join(", ")}`);
});
