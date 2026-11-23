// Put a built site on Cloudflare (a Worker serving static files) at its own
// address, then check the address serves what was built:
//
//   node tools/cloudflare-deploy.mjs <built folder> <worker name> <address>
//   node tools/cloudflare-deploy.mjs apps/web/dist osabooks osabooks.app
//
// The app moved off nbparagliding.nz, where it shared its origin -- and so the
// browser storage holding people's sign-ins -- with the paragliding school's
// other sites (code review of 20 November, section 5). Each app now has an
// address of its own.
//
// The site's headers are the ones its .htaccess sets (the page policy above
// all), written as Cloudflare's _headers file, so the two cannot drift apart.
// Signs in with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID where set (the
// GitHub Action), or with `npx wrangler login` on this computer.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [folderArg, name, address] = process.argv.slice(2);
if (folderArg === undefined || name === undefined || address === undefined) {
  console.error("node tools/cloudflare-deploy.mjs <built folder> <worker name> <address>");
  process.exit(2);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const folder = resolve(folderArg);
if (!existsSync(join(folder, "index.html"))) throw new Error(`Nothing built at ${folder}`);

/** The .htaccess's headers as Cloudflare's _headers. */
export function headersFrom(htaccess) {
  const always = [...htaccess.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"/gm)].map((m) => `  ${m[1]}: ${m[2]}`);
  if (!always.some((h) => h.startsWith("  Content-Security-Policy:"))) throw new Error("The .htaccess has no page policy to carry over.");
  // As .htaccess sets for html, js and css: asked about before reuse, so a
  // new build is the one that loads.
  const fresh = ["/", "/*.html", "/*.js", "/*.css"].flatMap((path) => [path, "  Cache-Control: no-cache, must-revalidate"]);
  return ["/*", ...always, "", ...fresh, ""].join("\n");
}

const work = mkdtempSync(join(tmpdir(), `cf-${name}-`));
try {
  const site = join(work, "site");
  // Everything built, but no .htaccess (Apache's) and never a test build's output.
  cpSync(folder, site, { recursive: true, filter: (from) => !/[\\/]\.htaccess$/.test(from) && !/[\\/]_irdtest([\\/]|$)/.test(from) });
  const htaccess = existsSync(join(folder, ".htaccess")) ? join(folder, ".htaccess") : join(root, "apps", "web", "public", ".htaccess");
  writeFileSync(join(site, "_headers"), headersFrom(readFileSync(htaccess, "utf8")));
  writeFileSync(
    join(work, "wrangler.json"),
    JSON.stringify({
      name,
      compatibility_date: "2026-11-01",
      assets: { directory: "./site" },
      routes: [{ pattern: address, custom_domain: true }],
      // Only at its own address: no second workers.dev one to keep in step.
      workers_dev: false,
      preview_urls: false,
    }, null, 2),
  );
  // Run from the work folder: in the repo, wrangler takes the workspace for a project of its own.
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "wrangler@4", "deploy"], { cwd: work, stdio: "inherit", shell: process.platform === "win32" });
} finally {
  rmSync(work, { recursive: true, force: true });
}

// What the address now serves, against what was built, asked again for up to a
// minute: a new address's certificate, or the edge's copy, can take a moment.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let bad = 0;
for (const file of ["index.html", "app.js", "styles.css"]) {
  if (!existsSync(join(folder, file))) continue;
  const built = hash(readFileSync(join(folder, file)));
  let served = "";
  for (let tries = 0; tries < 12; tries++) {
    try {
      const reply = await fetch(`https://${address}/${file === "index.html" ? "" : file}?v=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
      served = reply.ok ? hash(Buffer.from(await reply.arrayBuffer())) : `HTTP ${reply.status}`;
    } catch (error) {
      served = error instanceof Error ? error.message : String(error);
    }
    if (served === built) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`  ${file} ${served === built ? "matches" : `DIFFERS (${served.slice(0, 60)})`}`);
  if (served !== built) bad += 1;
}
const policy = (await fetch(`https://${address}/`, { headers: { "cache-control": "no-cache" } }).catch(() => null))?.headers.get("content-security-policy") ?? "";
console.log(`  page policy ${policy.startsWith("default-src") ? "served" : "MISSING"}`);
if (!policy.startsWith("default-src")) bad += 1;
process.exit(bad === 0 ? 0 : 1);
