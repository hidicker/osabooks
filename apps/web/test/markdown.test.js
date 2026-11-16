import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * An AI answer's Markdown, drawn to read: headings, lists, bold, tables -- and
 * nothing in the text ever becomes markup of its own.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-markdown-"));
const bundle = join(out, "markdown.mjs");
await build({ entryPoints: [join(root, "src", "markdown.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
test.after(() => rmSync(out, { recursive: true, force: true }));
const { markdownToHtml } = await import(pathToFileURL(bundle).href);

test("an answer's headings, lists, bold and paragraphs", () => {
  const html = markdownToHtml(
    "# Review\n\nThe year **mostly** hangs together.\n\n## Findings\n- GST on *fees* left out\n- Depreciation not run\n\n1. First\n2. Second",
  );
  assert.match(html, /<h4>Review<\/h4>/);
  assert.match(html, /<p>The year <strong>mostly<\/strong> hangs together.<\/p>/);
  assert.match(html, /<h5>Findings<\/h5>/);
  assert.match(html, /<ul><li>GST on <em>fees<\/em> left out<\/li><li>Depreciation not run<\/li><\/ul>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
});

test("a table", () => {
  const html = markdownToHtml("| Account | Amount |\n|---|---:|\n| 820 GST | 1,454.37 |\n| 840 | 4,130.98 |");
  assert.match(html, /<table class="report-table md-table"><thead><tr><th>Account<\/th><th>Amount<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><td>820 GST<\/td><td>1,454.37<\/td><\/tr><tr><td>840<\/td><td>4,130.98<\/td><\/tr>/);
});

test("nothing in the text becomes markup, and only web links are kept", () => {
  const html = markdownToHtml('<img src=x onerror="alert(1)"> and [bad](javascript:alert(1)) and [ok](https://example.com/a_b_c)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<a href="https:\/\/example.com\/a_b_c" target="_blank" rel="noopener noreferrer">ok<\/a>/);
});

test("code is shown as it is", () => {
  const html = markdownToHtml("Use `box_15` here.\n\n```\n**not bold**\n```");
  assert.match(html, /<code>box_15<\/code>/);
  assert.match(html, /<pre><code>\*\*not bold\*\*<\/code><\/pre>/);
});
