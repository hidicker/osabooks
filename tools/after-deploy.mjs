// Checks after a deploy, against the live site: node tools/after-deploy.mjs [app|demo|both]
//
// The upload script already checks that app.js, styles.css and index.html are
// the ones just built. This checks the rest of what people and AI apps reach:
//   - the app's and the demo's pages and files answer, every demo set of books
//     among them (a demo ledger left out of git is missed by the deploy);
//   - the old /nzosa/ addresses still send people on to /osabooks/;
//   - the extension download is a real file;
//   - the AI connector refuses a request with no sign-in, saying where to sign
//     in, the way Claude and other AI apps expect; and the consent page loads.
//
// Reads only: it signs in to nothing and changes nothing. Exit code 0 when
// every check passes. Needs Node 18 or later (fetch).
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://nbparagliding.nz";
const CLOUD = "https://ronancqtbbqmsiatxmfn.supabase.co";
const target = process.argv[2] ?? "both";
if (!["app", "demo", "both"].includes(target)) {
  console.error("Say app, demo or both.");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = 0;
let passed = 0;

function report(ok, what, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail === "" ? "" : ` -- ${detail}`}`);
}

/** Fetch, asked fresh, with a few tries: the host can be slow for a moment after an upload. */
async function get(url, init = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fresh = init.method === undefined || init.method === "GET" ? `${url}${url.includes("?") ? "&" : "?"}check=${Date.now()}` : url;
      return await fetch(fresh, { redirect: "manual", ...init, headers: { "Cache-Control": "no-cache", "User-Agent": "OsaBooks after-deploy check", ...(init.headers ?? {}) } });
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw last;
}

async function check(what, run) {
  try {
    const detail = await run();
    report(detail === true || typeof detail === "string" ? true : false, what, typeof detail === "string" ? detail : "");
  } catch (error) {
    report(false, what, error instanceof Error ? error.message : String(error));
  }
}

/** A page that answers 200 with what it should hold. */
function page(url, holds) {
  return check(url.replace(SITE, ""), async () => {
    const response = await get(url);
    if (response.status !== 200) throw new Error(`answered ${response.status}`);
    const text = await response.text();
    if (holds !== undefined && !holds.test(text)) throw new Error(`does not hold ${holds}`);
    return true;
  });
}

/** Every file under the demo folder in the repo, as paths below it. */
function demoFiles() {
  const base = join(root, "apps", "web", "public", "demo");
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(base, full).split("\\").join("/"));
    }
  };
  walk(base);
  return out.sort();
}

async function site(base, label) {
  console.log(`${label}: ${base}/`);
  await page(`${base}/`, /<title>[^<]*OsaBooks/);
  await page(`${base}/app.js`);
  await page(`${base}/styles.css`);
  await page(`${base}/privacy.html`, /OsaBooks/);
  await page(`${base}/terms.html`, /OsaBooks/);
  for (const file of demoFiles()) {
    await check(`${base.replace(SITE, "")}/demo/${file}`, async () => {
      const response = await get(`${base}/demo/${file}`);
      if (response.status !== 200) throw new Error(`answered ${response.status}`);
      const text = await response.text();
      if (file.endsWith(".json")) JSON.parse(text);
      if (text.length === 0) throw new Error("empty");
      return true;
    });
  }
}

async function redirect(from, to) {
  await check(`${from.replace(SITE, "")} sends on to ${to.replace(SITE, "")}`, async () => {
    const response = await get(from);
    const where = response.headers.get("location") ?? "";
    if (response.status < 300 || response.status > 308) throw new Error(`answered ${response.status}`);
    if (!where.startsWith(to)) throw new Error(`goes to ${where}`);
    return true;
  });
}

if (target === "app" || target === "both") {
  await site(`${SITE}/osabooks`, "The app");
  await page(`${SITE}/osabooks/home/`, /OsaBooks/);
  await page(`${SITE}/osabooks/oauth/consent/`, /Connect an AI app to OsaBooks/);
  await page(`${SITE}/osabooks/oauth/consent/go.js`);
  await check("/osabooks/osabooks.mcpb is the extension", async () => {
    const response = await get(`${SITE}/osabooks/osabooks.mcpb`);
    if (response.status !== 200) throw new Error(`answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // An .mcpb is a zip: it starts PK.
    if (bytes.length < 100_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`${bytes.length} bytes, not a zip`);
    return `${Math.round(bytes.length / 1024)} KB`;
  });
  await redirect(`${SITE}/nzosa/`, `${SITE}/osabooks/`);

  console.log("The AI connector");
  const connector = `${CLOUD}/functions/v1/mcp/00000000-0000-0000-0000-000000000000`;
  await check("refuses a request with no sign-in, and says where to sign in", async () => {
    const response = await get(connector, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    if (response.status !== 401) throw new Error(`answered ${response.status}`);
    const says = response.headers.get("www-authenticate") ?? "";
    if (!/^Bearer\b.*resource_metadata="[^"]+"/.test(says)) throw new Error(`WWW-Authenticate: ${says || "(none)"}`);
    return true;
  });
  await check("its sign-in details name the sign-in server", async () => {
    const response = await get(`${connector}/.well-known/oauth-protected-resource`);
    if (response.status !== 200) throw new Error(`answered ${response.status}`);
    const said = await response.json();
    if (!Array.isArray(said.authorization_servers) || !said.authorization_servers.some((s) => s.startsWith(CLOUD))) {
      throw new Error(JSON.stringify(said).slice(0, 200));
    }
    return true;
  });
  await check("the sign-in server describes itself", async () => {
    const response = await get(`${CLOUD}/.well-known/oauth-authorization-server/auth/v1`);
    if (response.status !== 200) throw new Error(`answered ${response.status}`);
    const said = await response.json();
    if (typeof said.authorization_endpoint !== "string" || typeof said.token_endpoint !== "string") throw new Error("no endpoints");
    return true;
  });
}

if (target === "demo" || target === "both") {
  await site(`${SITE}/osabooks_demo`, "The demo");
  await redirect(`${SITE}/nzosa_demo/`, `${SITE}/osabooks_demo/`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
