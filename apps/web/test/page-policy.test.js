import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every outside address the page itself fetches must be one its content
 * security policy allows, on the website (public/.htaccess) and on this
 * computer (server.js, pagePolicy): otherwise the browser refuses the request
 * before it leaves, and the feature fails with nothing on the page to say why.
 * That is how a visitor's own AI key in the online demo came to do nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..", "..");

function connectSources(policy) {
  const part = policy.split(";").map((p) => p.trim()).find((p) => p.startsWith("connect-src"));
  assert.ok(part, "the policy has a connect-src");
  return part.split(/\s+/).slice(1);
}

function allows(sources, host) {
  return sources.some((s) => {
    if (s === "'self'") return false;
    const pattern = s.replace(/^https:\/\//, "");
    if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Hosts the page asks directly: the AI providers a visitor's own key reaches, and every https address in a fetch in the app. */
function hostsFetched() {
  const hosts = new Set();
  const providers = readFileSync(join(root, "packages", "core", "src", "ai-providers.ts"), "utf8");
  for (const m of providers.matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
  for (const file of files(join(web, "src"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!/fetch\(/.test(line)) continue;
      for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
    }
  }
  return [...hosts].sort();
}

test("the website's page policy allows every address the page fetches", () => {
  const htaccess = readFileSync(join(web, "public", ".htaccess"), "utf8");
  const policy = /Content-Security-Policy "([^"]+)"/.exec(htaccess)?.[1] ?? "";
  const sources = connectSources(policy);
  const refused = hostsFetched().filter((h) => !allows(sources, h));
  assert.deepEqual(refused, [], `refused by public/.htaccess: ${refused.join(", ")}`);
});

test("the local server's page policy allows the same", () => {
  const server = readFileSync(join(web, "server.js"), "utf8");
  const line = /`connect-src ([^`$]+)/.exec(server)?.[1] ?? "";
  const sources = ["connect-src", ...line.trim().split(/\s+/)].join(" ");
  const refused = hostsFetched().filter((h) => !allows(connectSources(sources), h));
  assert.deepEqual(refused, [], `refused by server.js pagePolicy: ${refused.join(", ")}`);
});
