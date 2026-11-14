import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Source that a patch damaged on its way in. Edits made through a shell or a
 * script string can lose a backslash (`/^NB\s+/` arriving as `/^NBs+/`, which
 * matched nothing it was meant to, and cost an account its GST treatment) or
 * turn `\b` into a backspace character. Neither stops the build or the type
 * check, so they are looked for here, over all the source.
 *
 * A pattern that really means a letter before s, d or w with a repeat, as in
 * `/[A-Z]s+/`, takes `// escape-ok` on its line.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const SOURCES = [
  join(root, "packages"),
  join(root, "apps", "web", "src"),
  join(root, "apps", "web", "server.js"),
  join(root, "apps", "web", "build.js"),
  join(root, "supabase", "functions"),
  join(root, "supabase", "migrations"),
  join(root, "desktop"),
  join(root, "tools"),
];
const KINDS = /\.(ts|js|mjs|cjs|sql|sh)$/;
const SKIP = /node_modules|[\\/]dist[\\/]|[\\/]stage[\\/]|[\\/]release[\\/]|[\\/]test[\\/]|run\.js$|tools\.js$/;

function sourceFiles(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return KINDS.test(path) && !SKIP.test(path) ? [path] : [];
  if (SKIP.test(path + "/")) return [];
  return readdirSync(path).flatMap((name) => sourceFiles(join(path, name)));
}

const files = SOURCES.flatMap(sourceFiles);

test("the source is there to be checked", () => {
  assert.ok(files.length > 300, `found ${files.length} files`);
});

test("no control characters in the source (a \\b turned into a backspace, a stray escape)", () => {
  const found = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(line)) found.push(`${relative(root, file)}:${i + 1}`);
      });
  }
  assert.deepEqual(found, []);
});

test("no regular expression that seems to have lost the backslash before s, d or w", () => {
  const found = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes("escape-ok")) return;
        for (const m of line.matchAll(/\/\^?[^/\n]*?[A-Z)\]](s|d|w)[+*?]/g)) {
          if (/\\(s|d|w)[+*?]$/.test(m[0])) continue;
          found.push(`${relative(root, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
  }
  assert.deepEqual(found, []);
});
