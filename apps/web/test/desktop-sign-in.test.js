import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The desktop program's sign-in window (desktop/sign-in.cjs). Here rather than
 * in desktop/, which is not one of the workspaces the tests run in; the parts
 * that need Electron itself were tried in the program.
 *
 * A sign-in at the edition's service has to come back to the program to
 * finish: opened in the person's browser, it landed on the website, which
 * holds no licence key, and the connection was never made.
 */
const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..", "..", "..", "desktop");
const require = createRequire(import.meta.url);
const { isSignInStart, appReturn, mayShow } = require(join(desktop, "sign-in.cjs"));

const connect = ["https://filing.example"];

test("only a sign-in at the edition's own service stays in the program", () => {
  assert.equal(isSignInStart("https://filing.example/v1/connect/start?x=1", connect), true);
  assert.equal(isSignInStart("https://filing.example.evil.test/v1/connect/start", connect), false);
  assert.equal(isSignInStart("http://filing.example/v1/connect/start", connect), false);
  assert.equal(isSignInStart("https://www.ird.govt.nz/", connect), false);
  assert.equal(isSignInStart("not an address", connect), false);
  // OsaBooks connects to nothing, so nothing stays.
  assert.equal(isSignInStart("https://filing.example/v1/connect/start", []), false);
  assert.equal(isSignInStart("https://filing.example/v1/connect/start", undefined), false);
});

test("the service sending the person back is recognised by its fragment, wherever it points", () => {
  assert.equal(
    appReturn("https://pro.osabooks.app/#myir=finish&code=abc&state=def"),
    "myir=finish&code=abc&state=def",
  );
  assert.equal(appReturn("http://127.0.0.1:3216/#myir=failed"), "myir=failed");
  assert.equal(appReturn("https://pro.osabooks.app/#myir=connected"), null);
  assert.equal(appReturn("https://pro.osabooks.app/?myir=finish&code=abc"), null);
  assert.equal(appReturn("https://myir.ird.govt.nz/login"), null);
  assert.equal(appReturn("::"), null);
});

test("the sign-in window shows https, or a service on this computer, and nothing else", () => {
  assert.equal(mayShow("https://myir.ird.govt.nz/"), true);
  assert.equal(mayShow("http://127.0.0.1:3400/stand-in/myir"), true);
  assert.equal(mayShow("http://localhost:3400/"), true);
  assert.equal(mayShow("http://example.org/"), false);
  assert.equal(mayShow("file:///C:/Windows/"), false);
  assert.equal(mayShow("javascript:alert(1)"), false);
});

test("the installer carries the sign-in window", () => {
  const config = readFileSync(join(desktop, "build-config.cjs"), "utf8");
  assert.match(config, /files: \[[^\]]*"sign-in\.cjs"/);
  const main = readFileSync(join(desktop, "main.cjs"), "utf8");
  assert.match(main, /require\("\.\/sign-in\.cjs"\)/);
});
