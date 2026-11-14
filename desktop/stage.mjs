// Gather what the desktop program serves into desktop/stage/server: the built
// app, the local server, the core, and esbuild (which the server imports).
// Run by `npm start` and `npm run installer`, from the desktop folder, after
// `npm install` at the top of the repository.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const web = join(root, "apps", "web");
const out = join(here, "stage", "server");

// The core first, which the app and the server both use; then the app.
execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--build", join(root, "packages", "core")], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [join(web, "build.js")], { cwd: web, stdio: "inherit" });

rmSync(join(here, "stage"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), '{\n  "private": true,\n  "type": "module"\n}\n');
for (const file of ["server.js", "ledger-folder.js", "nightly.js"]) cpSync(join(web, file), join(out, file));
cpSync(join(web, "dist"), join(out, "dist"), { recursive: true });

const modules = join(out, "node_modules");
mkdirSync(join(modules, "@nzosa", "core"), { recursive: true });
cpSync(join(root, "packages", "core", "dist"), join(modules, "@nzosa", "core", "dist"), { recursive: true });
cpSync(join(root, "packages", "core", "package.json"), join(modules, "@nzosa", "core", "package.json"));

// esbuild and its platform binary: only this platform's, which is what the
// installer being built here is for.
cpSync(join(root, "node_modules", "esbuild"), join(modules, "esbuild"), { recursive: true });
const platform = `${process.platform}-${process.arch}`;
const native = join(root, "node_modules", "@esbuild", platform);
if (!existsSync(native)) throw new Error(`No esbuild binary for ${platform} in node_modules/@esbuild.`);
mkdirSync(join(modules, "@esbuild"), { recursive: true });
cpSync(native, join(modules, "@esbuild", platform), { recursive: true });

// Maps and type files are for developers, not the people who install this.
const prune = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) prune(path);
    else if (/\.(map|d\.ts|tsbuildinfo)$/.test(entry.name)) rmSync(path);
  }
};
prune(out);
console.log(`Staged the desktop server in ${out}`);
